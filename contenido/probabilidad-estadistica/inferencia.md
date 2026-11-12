# Intervalos de confianza

Intervalos de confianza para una media, una diferencia de medias y una proporción, con Z o con t según se conozca la varianza y el tamaño de la muestra (sesiones 12 y 14 del programa 2026-2). Es del Parcial 2, semana 16. Errores a cazar: leer el intervalo como una probabilidad sobre el parámetro, olvidar dividir entre √n y usar Z cuando toca t.

## Habilidades
kc: inferencia · Construir e interpretar intervalos de confianza para una media, una diferencia de medias y una proporción, eligiendo entre Z y t · prerrequisitos: distribuciones-muestrales, estimacion-puntual

## Errores
mc: inferencia-e1 · inferencia · interpretas el IC como probabilidad del parámetro
mc: inferencia-e2 · inferencia · confundes IC con rango de datos
mc: inferencia-e3 · inferencia · confundes parámetro con estadístico
mc: inferencia-e7 · inferencia · ignoras la condición de muestra pequeña
mc: inferencia-e8 · inferencia · crees que es imposible sin σ conocida
mc: inferencia-e9 · inferencia · confundes el estadístico apropiado
mc: ic-cuantil-una-cola-en-bilateral · inferencia · en un intervalo bilateral usas el cuantil de una cola (z_α o t_α) en vez del de α/2

## Preguntas

### P10 · dificultad 2 · kc: inferencia · revisada · origen: humano · revisó: prototipo
Un intervalo de confianza del 95% para la media μ significa que:

- A) Si repitieras el muestreo muchas veces, 95% de los intervalos contendrían μ · CORRECTA
- B) Hay 95% de probabilidad de que μ esté en este intervalo específico · [inferencia-e1]
- C) El 95% de los datos están en el intervalo · [inferencia-e2]
- D) La media muestral tiene 95% de confianza · [inferencia-e3]

### P12 · dificultad 2 · kc: inferencia · revisada · origen: humano · revisó: prototipo
Para construir un intervalo de confianza para μ cuando σ es desconocida y n < 30:

- A) Usas la distribución t de Student · CORRECTA
- B) Usas la distribución normal Z de todas formas · [inferencia-e7]
- C) No se puede construir el intervalo · [inferencia-e8]
- D) Usas la distribución chi-cuadrado · [inferencia-e9]

### P47 · dificultad 1 · kc: inferencia · borrador · origen: ia (sonnet-5.5)
Un ingeniero de procesos mide 40 ciclos de una máquina y construye un intervalo de confianza del 95% para el tiempo medio de ciclo: (12,4; 15,6) minutos. ¿Cuál afirmación es correcta?

- A) La probabilidad de que μ esté entre 12,4 y 15,6 es 0,95, porque el intervalo ya está calculado · [inferencia-e1] tratas el 95% como la probabilidad de que μ caiga dentro de este intervalo ya calculado
- B) La media muestral es 14,0 minutos, el punto medio del intervalo, y el margen de error es 1,6 minutos · CORRECTA
- C) El 95% de los tiempos de ciclo individuales están entre 12,4 y 15,6 minutos · [inferencia-e2] lees el intervalo como el rango donde cae la mayoría de los datos y no como un intervalo para la media
- D) La media poblacional es exactamente μ = 14,0 minutos, el punto medio del intervalo · [inferencia-e3] tomas el centro del intervalo, que es un estadístico de la muestra, como el valor del parámetro

solución: el intervalo es x̄ ± margen, así que x̄ = (12,4 + 15,6)/2 = 14,0 y el margen de error es (15,6 − 12,4)/2 = 1,6. El 95% describe el método (de muchos intervalos construidos así, cerca del 95% contiene a μ), no la probabilidad de este intervalo ni la proporción de datos que cubre, y μ sigue siendo desconocida.

### P48 · dificultad 2 · kc: inferencia · borrador · origen: ia (sonnet-5.5)
Un taller mide la resistencia a la tracción de 25 cables de acero de un mismo lote, con distribución aproximadamente normal, y obtiene x̄ = 48,3 kN y s = 3,5 kN. La desviación estándar de la población no se conoce. Calcula el IC al 95% de la resistencia media del lote (redondea a dos decimales; usa t₀,₀₂₅ = 2,064 con 24 grados de libertad; para comparar: z₀,₀₂₅ = 1,96 y t₀,₀₅ = 1,711 con 24 grados de libertad):

- A) (47,10; 49,50) · [ic-cuantil-una-cola-en-bilateral] usas t₀,₀₅ = 1,711, el cuantil de una cola, en un intervalo que deja 2,5% en cada cola
- B) (46,93; 49,67) · [inferencia-e7] usas z₀,₀₂₅ = 1,96 aunque la muestra es de 25 y σ es desconocida
- C) (46,86; 49,74) · CORRECTA
- D) No se puede construir el intervalo, porque no se conoce σ · [inferencia-e8] crees que sin σ conocida no hay intervalo, cuando s la reemplaza con la distribución t

solución: σ es desconocida y n = 25, así que se usa t con n − 1 = 24 grados de libertad. El error estándar es s/√n = 3,5/5 = 0,7 y el margen es 2,064 × 0,7 = 1,4448. El intervalo es 48,3 ± 1,4448 = (46,86; 49,74). Con z saldría ±1,372 y con t₀,₀₅ saldría ±1,198.

### P49 · dificultad 3 · kc: inferencia · borrador · origen: ia (sonnet-5.5)
Dos máquinas llenan frascos con un reactivo. Las poblaciones son normales y las desviaciones estándar se conocen por calibración: σ₁ = 3 mL y σ₂ = 4 mL. Con 8 frascos de la máquina 1 se obtuvo x̄₁ = 54,2 mL y con 10 frascos de la máquina 2, x̄₂ = 51,6 mL. El intervalo de confianza del 90% para μ₁ − μ₂ es (redondea a dos decimales; z₀,₀₅ = 1,645, z₀,₁₀ = 1,282 y t₀,₀₅ = 1,746 con 16 grados de libertad):

- A) (−0,12; 5,32) · CORRECTA
- B) (−0,28; 5,48) · [inferencia-e9] usas t con n₁ + n₂ − 2 grados de libertad aunque las desviaciones estándar son conocidas
- C) (0,48; 4,72) · [ic-cuantil-una-cola-en-bilateral] usas z₀,₁₀ = 1,282, que deja 10% en una cola, en vez de z₀,₀₅ para un intervalo bilateral del 90%
- D) (−5,63; 10,83) · [inferencia-e2] usas √(σ₁² + σ₂²) = 5 como error estándar sin dividir cada varianza entre su n, y obtienes un rango para datos individuales

solución: con σ conocidas se usa Z. La diferencia de medias es 54,2 − 51,6 = 2,6. El error estándar es √(σ₁²/n₁ + σ₂²/n₂) = √(9/8 + 16/10) = √2,725 = 1,6508. Para 90%, z₀,₀₅ = 1,645, así que el margen es 1,645 × 1,6508 = 2,7155 y el intervalo es 2,6 ± 2,7155 = (−0,12; 5,32). Como contiene el 0, con este nivel no se puede afirmar que las medias difieran.

### P50 · dificultad 3 · kc: inferencia · borrador · origen: ia (sonnet-5.5)
En un lote se inspeccionan 40 rodamientos y 12 resultan defectuosos. El intervalo de confianza del 99% para la proporción p de defectuosos del lote es (redondea a tres decimales; z₀,₀₀₅ = 2,576, z₀,₀₁ = 2,326 y t₀,₀₀₅ = 2,708 con 39 grados de libertad):

- A) (0,104; 0,496) · [inferencia-e9] usas el cuantil t con n − 1 grados de libertad, que es de una media, para una proporción
- B) No se puede construir el intervalo, porque no se conoce la desviación estándar poblacional · [inferencia-e8] crees que hace falta σ conocida, sin ver que p̂ da el error estándar de la proporción
- C) (0,131; 0,469) · [ic-cuantil-una-cola-en-bilateral] usas z₀,₀₁ = 2,326, el cuantil de una cola, en un intervalo bilateral del 99%
- D) (0,113; 0,487) · CORRECTA

solución: p̂ = 12/40 = 0,30. El error estándar es √(p̂(1 − p̂)/n) = √(0,3 × 0,7/40) = √0,00525 = 0,07246. Para 99% el cuantil bilateral es z₀,₀₀₅ = 2,576, así que el margen es 2,576 × 0,07246 = 0,1867 y el intervalo es 0,30 ± 0,1867 = (0,113; 0,487). Con z₀,₀₁ saldría ±0,1685 y con t₀,₀₀₅ saldría ±0,1962.
