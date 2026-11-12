# Estadística descriptiva y estimación puntual

Estadística descriptiva (media, mediana, varianza y percentiles) y estimación puntual: sesgo, varianza y error cuadrático medio de un estimador, y estimadores de máxima verosimilitud (sesión 11 del programa 2026-2). Es del Parcial 2, semana 16.

## Habilidades
kc: estimacion-puntual · Calcular estadísticas descriptivas, evaluar el sesgo, la varianza y el error cuadrático medio de un estimador y hallar estimadores de máxima verosimilitud · prerrequisitos: suma-tlc

## Errores
mc: mediana-sin-ordenar · estimacion-puntual · te saltas el orden y tomas el dato del medio tal como aparece en la lista
mc: confunde-media-y-mediana · estimacion-puntual · confundes la media con la mediana y entregas una cuando piden la otra
mc: n-contra-n-menos-1 · estimacion-puntual · confundes cuándo se usa n y cuándo n − 1, ya sea en una posición, en una varianza o en un estimador
mc: ecm-sin-sesgo-cuadrado · estimacion-puntual · calculas el error cuadrático medio con la varianza sola y olvidas sumar el sesgo al cuadrado
mc: insesgado-implica-menor-ecm · estimacion-puntual · crees que el estimador insesgado siempre es el de menor error cuadrático medio
mc: mle-una-sola-observacion · estimacion-puntual · maximizas la densidad de una sola observación en vez de la verosimilitud de toda la muestra
mc: mle-derivada-pierde-n · estimacion-puntual · al derivar la log-verosimilitud pierdes el factor n y despejas mal el parámetro

## Preguntas

### P41 · dificultad 1 · kc: estimacion-puntual · borrador · origen: ia (sonnet-5.5)
Un servidor de reservas registró siete tiempos de respuesta, en milisegundos, en el orden en que llegaron las peticiones: 14, 6, 40, 16, 13, 8, 11. La mediana de la muestra, en milisegundos, es:

- A) 16 · [mediana-sin-ordenar] tomas el cuarto dato de la lista tal como llegó, sin ordenar los tiempos de menor a mayor
- B) 13 · CORRECTA
- C) 15,43 · [confunde-media-y-mediana] calculas el promedio de los siete tiempos, que es la media y no la mediana
- D) 11 · [n-contra-n-menos-1] ordenas los datos pero tomas la posición (n − 1)/2 = 3 en vez de la posición (n + 1)/2 = 4

solución: se ordenan los datos de menor a mayor: 6, 8, 11, 13, 14, 16, 40. Con n = 7 (impar) la mediana es el dato en la posición (n + 1)/2 = 4, que vale 13.
Las otras opciones salen de errores concretos: el cuarto dato sin ordenar es 16; la media es 108/7 ≈ 15,43; el tercer dato ordenado es 11.

### P42 · dificultad 2 · kc: estimacion-puntual · borrador · origen: ia (sonnet-5.5)
Un laboratorio midió la resistencia, en MPa, de ocho probetas de concreto, en este orden: 52, 38, 61, 45, 90, 41, 47, 56. La mediana de la muestra, en MPa, es:

- A) 53,75 · [confunde-media-y-mediana] das el promedio de las ocho mediciones en lugar de la mediana
- B) 46 · [n-contra-n-menos-1] ordenas bien, pero promedias el tercer y el cuarto dato en vez del cuarto y el quinto
- C) 67,5 · [mediana-sin-ordenar] promedias el cuarto y el quinto dato de la lista original, sin haberla ordenado
- D) 49,5 · CORRECTA

solución: ordenados, los datos son 38, 41, 45, 47, 52, 56, 61, 90. Con n = 8 (par) la mediana es el promedio de los datos en las posiciones n/2 = 4 y n/2 + 1 = 5: (47 + 52)/2 = 49,5.
Las otras opciones: la media es 430/8 = 53,75; el promedio del tercer y el cuarto dato ordenados es (45 + 47)/2 = 46; el promedio del cuarto y el quinto de la lista sin ordenar es (45 + 90)/2 = 67,5.

### P43 · dificultad 2 · kc: estimacion-puntual · borrador · origen: ia (sonnet-5.5)
Un sensor de vibración entrega lecturas normales con varianza σ² desconocida, y se dispone de 8 lecturas independientes. El estimador σ̂² = (1/n)·Σ(Xᵢ − X̄)² tiene sesgo −σ²/n y varianza 2(n − 1)σ⁴/n². El estimador S² = (1/(n − 1))·Σ(Xᵢ − X̄)² es insesgado y tiene varianza 2σ⁴/(n − 1). Con n = 8, el error cuadrático medio de σ̂², en unidades de σ⁴ y redondeado a dos decimales, es:

- A) 0,29 · [insesgado-implica-menor-ecm] tomas el estimador insesgado S² por ser insesgado y das su error, 2/(n − 1)
- B) 0,23 · CORRECTA
- C) 0,27 · [n-contra-n-menos-1] usas n en vez de n − 1 en la varianza de σ̂², 2/n, y le sumas el sesgo al cuadrado
- D) 0,22 · [ecm-sin-sesgo-cuadrado] das solo la varianza de σ̂² y no sumas el sesgo al cuadrado

solución: ECM = varianza + sesgo². La varianza vale 2(n − 1)/n² = 2·7/64 ≈ 0,2188 (en unidades de σ⁴) y el sesgo al cuadrado vale (1/n)² = 1/64 ≈ 0,0156. Entonces ECM ≈ 0,2188 + 0,0156 = 0,2344σ⁴ ≈ 0,23σ⁴.
Las otras opciones: 2/7 ≈ 0,29 es el error de S²; 2/8 + 1/64 ≈ 0,27 usa n en la varianza; 0,22 omite el sesgo.

### P44 · dificultad 2 · kc: estimacion-puntual · borrador · origen: ia (sonnet-5.5)
El número de fallas diarias de una máquina se modela como Poisson con parámetro λ desconocido. En ocho días se observaron, en este orden, 4, 2, 7, 3, 9, 3, 5 y 3 fallas. La estimación de máxima verosimilitud de λ es:

- A) 4 · [mle-una-sola-observacion] maximizas la probabilidad de la primera observación sola, cuyo máximo está en λ = 4
- B) 36 · [mle-derivada-pierde-n] al derivar la log-verosimilitud olvidas el término −n y despejas λ = Σxᵢ
- C) 3,5 · [confunde-media-y-mediana] das la mediana de los datos y no el promedio que maximiza la verosimilitud
- D) 4,5 · CORRECTA

solución: la verosimilitud es L(λ) = Π e^(−λ) λ^(xᵢ)/xᵢ!, así que ln L = −nλ + (Σxᵢ)·ln λ − Σ ln(xᵢ!). Derivando: −n + Σxᵢ/λ = 0, de donde λ̂ = Σxᵢ/n = x̄. Aquí Σxᵢ = 36 y n = 8, entonces λ̂ = 4,5.
Las otras opciones: la primera observación vale 4; la suma sin dividir entre n es 36; la mediana ordenada es (3 + 4)/2 = 3,5.

### P45 · dificultad 3 · kc: estimacion-puntual · borrador · origen: ia (sonnet-5.5)
El caudal de una bomba, en L/min, varía de un ciclo a otro con media μ = 4 (desconocida para quien estima) y varianza σ² = 64. Con 16 ciclos independientes se proponen los estimadores μ̂₁ = X̄ y μ̂₂ = 0,9·X̄ para μ. El estimador con menor error cuadrático medio y el valor de ese error son:

- A) μ̂₁, con ECM = 4 · [insesgado-implica-menor-ecm] eliges μ̂₁ porque es insesgado, sin comparar los dos errores cuadráticos medios
- B) μ̂₂, con ECM = 3,24 · [ecm-sin-sesgo-cuadrado] usas solo la varianza de μ̂₂ y olvidas su sesgo al cuadrado
- C) μ̂₂, con ECM = 3,40 · CORRECTA
- D) μ̂₂, con ECM = 3,62 · [n-contra-n-menos-1] calculas la varianza de X̄ como σ²/(n − 1) en vez de σ²/n

solución: Var(X̄) = σ²/n = 64/16 = 4, así que ECM(μ̂₁) = 4 porque no tiene sesgo.
Para μ̂₂: Var(0,9·X̄) = 0,9²·4 = 3,24 y el sesgo es E[μ̂₂] − μ = 0,9·4 − 4 = −0,4, cuyo cuadrado es 0,16. Entonces ECM(μ̂₂) = 3,24 + 0,16 = 3,40, menor que 4: aunque está sesgado, μ̂₂ gana.
Las otras opciones: 3,24 omite el sesgo; con σ²/(n − 1) = 64/15 se obtiene 0,81·(64/15) + 0,16 ≈ 3,62.

### P46 · dificultad 3 · kc: estimacion-puntual · borrador · origen: ia (sonnet-5.5)
Una balanza produce lecturas normales con media 10 g, que es el valor real conocido de la pesa, y desviación estándar σ desconocida. En cinco lecturas se obtuvo 12, 7, 11, 9 y 16 g. La estimación de máxima verosimilitud de σ, redondeada a dos decimales, es:

- A) 3,19 · CORRECTA
- B) 7,14 · [mle-derivada-pierde-n] al derivar la log-verosimilitud olvidas el factor n y obtienes σ̂² = Σ(xᵢ − 10)² = 51 antes de sacar la raíz
- C) 2,00 · [mle-una-sola-observacion] maximizas solo con la primera lectura y obtienes |12 − 10|
- D) 3,57 · [n-contra-n-menos-1] divides la suma de cuadrados entre n − 1 = 4, como en S², en vez de entre n

solución: con media conocida, ln L = −(n/2)·ln(2πσ²) − Σ(xᵢ − 10)²/(2σ²). Derivando respecto a σ²: −n/(2σ²) + Σ(xᵢ − 10)²/(2σ⁴) = 0, de donde σ̂² = Σ(xᵢ − 10)²/n. Las desviaciones son 2, −3, 1, −1, 6 y sus cuadrados suman 4 + 9 + 1 + 1 + 36 = 51, así que σ̂² = 51/5 = 10,2.
Por la propiedad de invariancia, σ̂ = √10,2 ≈ 3,19.
Las otras opciones: √51 ≈ 7,14 pierde el factor n; |12 − 10| = 2 usa una sola lectura; √(51/4) ≈ 3,57 divide entre n − 1.
