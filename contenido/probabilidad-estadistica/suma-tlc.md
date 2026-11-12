# Suma de variables, teorema del límite central y distribuciones muestrales

Valor esperado y varianza de sumas, promedios y combinaciones lineales de variables independientes, aproximación de sus probabilidades con el teorema del límite central, y uso de las distribuciones t, chi-cuadrado y F para construir intervalos de una varianza o de una razón de varianzas. Corresponde a la sesión 10 del programa 2026-2 y al uso de χ² y F de la sesión 12; es del Parcial 2, semana 16.

## Habilidades
kc: suma-tlc · Hallar la media y la varianza de sumas, promedios y combinaciones lineales de variables, y aproximar sus probabilidades con el teorema del límite central · prerrequisitos: covarianza-correlacion, continuas
kc: distribuciones-muestrales · Usar las distribuciones t, chi-cuadrado y F con sus grados de libertad y tablas, y construir intervalos para una varianza o una razón de varianzas · prerrequisitos: suma-tlc

## Errores
mc: stlc-var-resta-restando · suma-tlc · crees que la varianza de una diferencia es la resta de las varianzas
mc: stlc-var-escala-lineal · suma-tlc · crees que Var(aX) = a·Var(X) y no multiplicas la varianza por a²
mc: stlc-suma-desviaciones · suma-tlc · sumas las desviaciones estándar en vez de sumar las varianzas
mc: stlc-sd-sin-raiz-n · suma-tlc · usas σ como la desviación estándar del promedio o de la suma, sin σ/√n ni σ√n
mc: stlc-suma-como-n-por-x · suma-tlc · tratas X₁ + … + Xₙ como n·X y la varianza te queda n²σ² en vez de nσ²
mc: stlc-cola-sin-complemento · suma-tlc · lees P(Z > z) directo de la tabla acumulada, sin restarla de 1
mc: dm-gl-n-en-vez-de-n-menos-1 · distribuciones-muestrales · usas n grados de libertad en vez de n − 1
mc: dm-chi2-sin-n-menos-1 · distribuciones-muestrales · usas S²/σ² como si fuera chi-cuadrado, sin multiplicar por (n − 1)
mc: dm-chi2-cuantil-en-numerador · distribuciones-muestrales · en el intervalo de σ² multiplicas S² por el cuantil chi-cuadrado en vez de dividir (n − 1)S² entre él
mc: dm-f-gl-intercambiados · distribuciones-muestrales · intercambias los grados de libertad del numerador y del denominador al buscar el cuantil de la F
mc: dm-f-cola-inferior-sin-reciproco · distribuciones-muestrales · para la cola inferior de la F usas el cuantil de cola superior, sin tomar el recíproco
mc: dm-ic-sigma2-en-vez-de-sigma · distribuciones-muestrales · das el intervalo de σ² cuando piden el de σ, sin sacar la raíz
mc: dm-razon-invertida · distribuciones-muestrales · pones el cociente de varianzas al revés

## Preguntas

### P31 · dificultad 1 · kc: suma-tlc · borrador · origen: ia (sonnet-5.5)
Un sensor registra dos señales independientes, X e Y, con desviaciones estándar 3 y 2. La lectura corregida es R = 2X − Y. ¿Cuál es la desviación estándar de R? Redondea a dos decimales.

- A) 6,32 · CORRECTA
- B) 5,66 · [stlc-var-resta-restando] restas las varianzas 36 − 4 en vez de sumarlas porque la combinación tiene una resta
- C) 4,69 · [stlc-var-escala-lineal] calculas Var(2X) como 2·9 y no como 4·9
- D) 8,00 · [stlc-suma-desviaciones] sumas 2·3 + 2 en vez de sumar las varianzas 36 y 4 y sacar la raíz

solución: las señales son independientes, así que Var(R) = 2²·Var(X) + (−1)²·Var(Y) = 4·9 + 1·4 = 40. La desviación estándar es √40 ≈ 6,32. La resta no cambia el signo de la varianza, porque el coeficiente −1 queda al cuadrado.

### P32 · dificultad 2 · kc: suma-tlc · borrador · origen: ia (sonnet-5.5)
En una línea de empaque, el peso de un lote es S = X₁ + X₂ + X₃ + X₄, con las Xᵢ independientes y de varianza 5 cada una. A S se le suma una carga W = 2Y, donde Y tiene varianza 3 y es independiente de las Xᵢ. ¿Cuál es la desviación estándar de S + W? Redondea a dos decimales.

- A) 5,66 · CORRECTA
- B) 9,59 · [stlc-suma-como-n-por-x] tratas X₁ + X₂ + X₃ + X₄ como 4·X₁ y obtienes 16·5 en vez de 4·5
- C) 5,10 · [stlc-var-escala-lineal] calculas Var(2Y) como 2·3 y no como 4·3
- D) 7,94 · [stlc-suma-desviaciones] sumas la desviación estándar de S, √20, con la de W, 2√3

solución: Var(S) = 4·5 = 20, por independencia. Var(W) = 2²·Var(Y) = 4·3 = 12. Como S y W son independientes, Var(S + W) = 20 + 12 = 32 y la desviación estándar es √32 ≈ 5,66.

### P33 · dificultad 2 · kc: suma-tlc · borrador · origen: ia (sonnet-5.5)
El tiempo de atención de un cliente en una caja tiene media 20 minutos y desviación estándar 5 minutos, con una distribución que no se conoce. Los tiempos de 9 clientes son independientes. Con el teorema del límite central, ¿cuál es la probabilidad de que el tiempo total de atención de los 9 clientes supere 195 minutos? Redondea z a dos decimales y usa la tabla normal estándar.

- A) 0,1587 · CORRECTA
- B) 0,8413 · [stlc-cola-sin-complemento] lees la probabilidad acumulada hasta z = 1 y no la cola derecha
- C) 0,3707 · [stlc-suma-como-n-por-x] tratas el total como 9·X y usas una desviación estándar de 45
- D) 0,0013 · [stlc-sd-sin-raiz-n] estandarizas el total con σ = 5 en vez de 5·√9

solución: el total T tiene media 9·20 = 180 y varianza 9·25 = 225, o sea desviación estándar 15. z = (195 − 180)/15 = 1,00 y P(T > 195) = 1 − Φ(1,00) = 1 − 0,8413 = 0,1587.

### P34 · dificultad 3 · kc: suma-tlc · borrador · origen: ia (sonnet-5.5)
Un kit de ensamblaje lleva 4 piezas de tipo A y 3 piezas de tipo B, todas distintas e independientes entre sí. El peso en gramos de una pieza A tiene media 40 y varianza 7; el de una pieza B tiene media 25 y varianza 24. Los pesos siguen una distribución normal. ¿Cuál es la probabilidad de que el kit pese más de 250 g? Redondea z a dos decimales y usa la tabla normal estándar.

- A) 0,0668 · CORRECTA
- B) 0,9332 · [stlc-cola-sin-complemento] lees la probabilidad acumulada hasta z = 1,50 y no la cola derecha
- C) 0,2776 · [stlc-suma-desviaciones] sumas las desviaciones estándar 4·√7 + 3·√24 en vez de sumar las varianzas
- D) 0,2033 · [stlc-suma-como-n-por-x] tratas las 4 piezas A como 4·A y las 3 piezas B como 3·B, con varianzas 16·7 y 9·24

solución: media del kit = 4·40 + 3·25 = 235. Las piezas son independientes y distintas, así que Var = 4·7 + 3·24 = 28 + 72 = 100 y la desviación estándar es 10. El peso es normal, entonces z = (250 − 235)/10 = 1,50 y P(W > 250) = 1 − 0,9332 = 0,0668.

### P35 · dificultad 3 · kc: suma-tlc · borrador · origen: ia (sonnet-5.5)
Dos líneas de producción son independientes. El tiempo de ciclo de la línea 1 tiene media 40 min y varianza 36; el de la línea 2 tiene media 38 min y varianza 18. Ninguna distribución se conoce. Se observan 36 ciclos de la línea 1 y 32 ciclos de la línea 2, y se calculan los promedios X̄₁ y X̄₂. Con el teorema del límite central, ¿cuál es la probabilidad de que X̄₁ − X̄₂ supere 3,25 min? Redondea z a dos decimales y usa la tabla normal estándar.

- A) 0,1587 · CORRECTA
- B) 0,0294 · [stlc-var-resta-restando] restas las varianzas de los promedios, 1 − 0,5625, en vez de sumarlas
- C) 0,4325 · [stlc-sd-sin-raiz-n] estandarizas con las desviaciones σ₁ y σ₂ sin dividir entre √n
- D) 0,8413 · [stlc-cola-sin-complemento] lees la probabilidad acumulada hasta z = 1,00 y no la cola derecha

solución: E[X̄₁ − X̄₂] = 40 − 38 = 2. Las muestras son independientes, así que Var(X̄₁ − X̄₂) = 36/36 + 18/32 = 1 + 0,5625 = 1,5625 y la desviación estándar es 1,25. Con tamaños mayores que 30 el TLC permite usar la normal: z = (3,25 − 2)/1,25 = 1,00 y P = 1 − 0,8413 = 0,1587.

### P36 · dificultad 1 · kc: distribuciones-muestrales · borrador · origen: ia (sonnet-5.5)
De una población normal se toma una muestra de n = 12 mediciones y resulta una varianza muestral s² = 14. Se supone que σ² = 9. ¿Cuál es el valor observado del estadístico que sigue una distribución chi-cuadrado? Redondea a dos decimales.

- A) 17,11 · CORRECTA
- B) 1,56 · [dm-chi2-sin-n-menos-1] calculas solo s²/σ² = 14/9 y no lo multiplicas por 11
- C) 18,67 · [dm-gl-n-en-vez-de-n-menos-1] multiplicas por n = 12 en vez de por n − 1 = 11
- D) 7,07 · [dm-razon-invertida] calculas 11·σ²/s², con la varianza poblacional en el numerador

solución: el estadístico es (n − 1)S²/σ² = 11·14/9 ≈ 17,11, que sigue una chi-cuadrado con n − 1 = 11 grados de libertad.

### P37 · dificultad 2 · kc: distribuciones-muestrales · borrador · origen: ia (sonnet-5.5)
Un sensor de temperatura de un horno industrial registró n = 11 lecturas, de una población normal, con desviación estándar muestral s = 1,8 °C (así que s² = 3,24). Con 10 grados de libertad: χ²₀,₀₂₅ = 20,483 y χ²₀,₉₇₅ = 3,247. Con 11 grados de libertad: χ²₀,₀₂₅ = 21,920 y χ²₀,₉₇₅ = 3,816. Construye un intervalo al 95% de confianza para la desviación estándar poblacional σ. Redondea a dos decimales.

- A) (1,26; 3,16) · CORRECTA
- B) (1,58; 9,98) · [dm-ic-sigma2-en-vez-de-sigma] das el intervalo de σ², sin sacar la raíz a los extremos
- C) (1,22; 2,91) · [dm-gl-n-en-vez-de-n-menos-1] usas 11 grados de libertad en vez de 10
- D) (1,03; 2,58) · [dm-chi2-cuantil-en-numerador] multiplicas s² por cada cuantil y divides entre 10 en vez de dividir 10·s² entre el cuantil

solución: el intervalo de σ² es (10·3,24/20,483; 10·3,24/3,247) = (1,58; 9,98), con n − 1 = 10 grados de libertad. Como piden σ se saca la raíz de cada extremo: (√1,58; √9,98) = (1,26; 3,16).

### P38 · dificultad 2 · kc: distribuciones-muestrales · borrador · origen: ia (sonnet-5.5)
Se toman dos muestras independientes de poblaciones normales con la misma varianza: n₁ = 7 y n₂ = 11. Sean S₁² y S₂² sus varianzas muestrales. Se busca el valor c tal que P(S₁²/S₂² < c) = 0,05. Valores de tabla para F₀,₀₅ (cola superior) según los grados de libertad (numerador, denominador): (6, 10): 3,22; (10, 6): 4,06; (7, 11): 3,01; (11, 7): 3,60. Redondea c a tres decimales.

- A) 0,246 · CORRECTA
- B) 0,311 · [dm-f-gl-intercambiados] tomas el recíproco, pero con el cuantil que tiene los grados de libertad en el orden (6, 10)
- C) 3,220 · [dm-f-cola-inferior-sin-reciproco] usas el cuantil de cola superior F₀,₀₅ directamente como si fuera el de la cola inferior
- D) 0,278 · [dm-gl-n-en-vez-de-n-menos-1] usas 7 y 11 grados de libertad en vez de 6 y 10

solución: S₁²/S₂² sigue una F con (n₁ − 1, n₂ − 1) = (6, 10) grados de libertad. El cuantil de cola inferior se obtiene con el recíproco del cuantil de cola superior con los grados de libertad intercambiados: c = 1/F₀,₀₅(10, 6) = 1/4,06 ≈ 0,246.

### P39 · dificultad 3 · kc: distribuciones-muestrales · borrador · origen: ia (sonnet-5.5)
Dos muestras independientes de poblaciones normales dan n₁ = 9, s₁² = 18 y n₂ = 13, s₂² = 6. Para un intervalo de confianza del 90% de σ₁²/σ₂², los valores de tabla son F₀,₀₅ (cola superior) con (8, 12) grados de libertad: 2,85, y con (12, 8): 3,28. ¿Cuál es el intervalo? Redondea a dos decimales.

- A) (1,05; 9,84) · CORRECTA
- B) (0,91; 8,55) · [dm-f-gl-intercambiados] usas 3,28 para el extremo inferior y 2,85 para el superior, con los grados de libertad al revés
- C) (8,55; 9,84) · [dm-f-cola-inferior-sin-reciproco] en el extremo inferior multiplicas el cociente por el cuantil de cola superior en vez de dividir
- D) (0,12; 1,09) · [dm-razon-invertida] construyes el intervalo con s₂²/s₁² = 1/3, que es el de σ₂²/σ₁²

solución: el cociente de las varianzas muestrales es 18/6 = 3. Con 8 y 12 grados de libertad, el extremo inferior es 3/F₀,₀₅(8, 12) = 3/2,85 ≈ 1,05 y el superior es 3·F₀,₀₅(12, 8) = 3·3,28 ≈ 9,84. El intervalo de σ₁²/σ₂² es (1,05; 9,84).

### P40 · dificultad 3 · kc: distribuciones-muestrales · borrador · origen: ia (sonnet-5.5)
Una muestra de n = 25 diámetros de una población normal tiene s = 3 (s² = 9). Con 24 grados de libertad: χ²₀,₀₅ = 36,415 y χ²₀,₉₅ = 13,848. ¿Cuál es el límite superior del intervalo de confianza del 90% para la desviación estándar poblacional σ? Redondea a dos decimales.

- A) 3,95 · CORRECTA
- B) 15,60 · [dm-ic-sigma2-en-vez-de-sigma] das el límite superior de σ², sin sacar la raíz
- C) 3,70 · [dm-chi2-cuantil-en-numerador] calculas 36,415·9/24 y sacas la raíz, en vez de dividir 24·9 entre 13,848
- D) 0,81 · [dm-chi2-sin-n-menos-1] divides s² entre 13,848 sin multiplicar por 24 y sacas la raíz

solución: el límite superior de σ² usa el cuantil chi-cuadrado más pequeño: 24·9/13,848 ≈ 15,60. Para σ se saca la raíz: √15,60 ≈ 3,95.
