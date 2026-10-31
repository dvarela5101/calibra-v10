# Medición de desempeño

Correlación, IOPS, leyes operacionales y speedup. Es del Parcial 4.

## Habilidades
kc: correlacion-regresion · Interpretar un coeficiente de correlación y usar una recta de regresión para proyectar cuándo una métrica cruza su límite
kc: iops-latencia · Calcular IOPS totales y transacciones por segundo, y relacionar la carga del disco con su tiempo de respuesta
kc: leyes-operacionales · Aplicar la ley de utilización (U = a·Rs), el tiempo de respuesta (R = Rs/(1 − U)) y la ley de Little (N = a·R), y decidir con ellas cuál sistema está más cerca de saturarse · prerrequisitos: iops-latencia
kc: speedup · Calcular el speedup entre dos configuraciones y estimar con él el nuevo throughput · prerrequisitos: tiempo-ejecucion

## Errores
mc: corr-correlacion-es-causa · correlacion-regresion · concluyes que una correlación alta demuestra que una variable causa la otra
mc: corr-cercana-a-cero-es-fuerte · correlacion-regresion · lees un coeficiente cercano a 0 como una relación lineal fuerte
mc: corr-r-como-porcentaje · correlacion-regresion · lees r como el porcentaje de datos o de variación que explica la otra variable, sin elevarlo al cuadrado
mc: corr-despeje-sin-intercepto · correlacion-regresion · al despejar el mes en que se cruza el límite divides el límite entre la pendiente sin restar el intercepto
mc: corr-despeje-suma-intercepto · correlacion-regresion · al despejar el mes en que se cruza el límite sumas el intercepto en vez de restarlo
mc: corr-indice-por-meses-faltantes · correlacion-regresion · entregas el número del mes en que se cruza el límite como si fueran los meses que faltan desde hoy
mc: iops-solo-lecturas · iops-latencia · cuentas solo las lecturas como si fueran los IOPS totales
mc: iops-promedia-en-vez-de-sumar · iops-latencia · promedias las lecturas y las escrituras en vez de sumarlas
mc: iops-transacciones-mal-convertidas · iops-latencia · al pasar entre transacciones e IOPS haces la operación contraria, multiplicas donde debías dividir o al revés
mc: iops-capacidad-mal-convertida · iops-latencia · conviertes mal el tiempo de servicio en milisegundos a operaciones por segundo de capacidad
mc: iops-latencia-proporcional · iops-latencia · crees que la latencia crece en línea recta con la carga o que no cambia hasta llenar el disco, y no ves que se dispara cerca del límite
mc: iops-alto-es-bueno · iops-latencia · lees un IOPS alto como buen desempeño sin mirar cuánto sube el tiempo de respuesta
mc: leyes-mayor-n-menos-riesgo · leyes-operacionales · crees que el sistema con más peticiones dentro (mayor N) está más lejos de saturarse, y no miras U
mc: leyes-coma-corrida · leyes-operacionales · corres la coma al dividir o al convertir y el resultado sale diez veces mayor o menor
mc: leyes-ms-con-s · leyes-operacionales · metes el tiempo de servicio en milisegundos junto con la tasa en peticiones por segundo sin convertirlo
mc: leyes-umbral-80 · leyes-operacionales · tomas 80 % como el umbral de saturación de la controladora de disco
mc: leyes-divide-por-u · leyes-operacionales · divides Rs entre U en vez de dividirlo entre (1 − U)
mc: leyes-little-dividida · leyes-operacionales · aplicas la ley de Little dividiendo (a entre R o R entre a) en vez de multiplicar a·R
mc: speedup-invertido · speedup · divides el tiempo rápido entre el lento y obtienes el speedup al revés
mc: speedup-resta-tiempos · speedup · restas los dos tiempos en vez de dividirlos
mc: speedup-throughput-dividido · speedup · para el nuevo throughput divides el throughput viejo entre el speedup en vez de multiplicar
mc: speedup-throughput-sumado · speedup · sumas el speedup al throughput viejo en vez de multiplicarlo
mc: speedup-unidades-mezcladas · speedup · divides dos tiempos o conviertes una tasa sin pasarlos a la misma unidad (ms con s, minutos con segundos)

## Preguntas

### P51 · dificultad 1 · kc: correlacion-regresion · borrador · origen: ia (sonnet-5.5)
Durante 12 meses, un equipo de TI midió el uso promedio de RAM y el tiempo de respuesta de un servidor de pedidos, y obtuvo un coeficiente de correlación r = 0,05 entre ambos. ¿Qué se concluye?

- A) Existe una relación lineal muy estrecha, porque un valor tan cercano a 0 indica datos muy regulares · [corr-cercana-a-cero-es-fuerte]
- B) La RAM causa un pequeño aumento del tiempo de respuesta, de más o menos 5 % · [corr-correlacion-es-causa]
- C) No hay una relación lineal apreciable entre el uso de RAM y el tiempo de respuesta, así que la RAM no sirve para proyectar ese tiempo con una recta · CORRECTA
- D) Solo el 5 % de los meses sigue la tendencia lineal entre las dos variables · [corr-r-como-porcentaje]

solución: el coeficiente r mide qué tan alineados están los puntos sobre una recta: ±1 es una relación lineal perfecta y 0 es ausencia de relación lineal. Con r = 0,05 la nube de puntos casi no tiene tendencia lineal, de modo que una recta de regresión con la RAM no permitiría proyectar el tiempo de respuesta. Un valor cercano a 0 no es una relación fuerte (A), una correlación no mide causalidad ni un efecto del 5 % (B) y r no es el porcentaje de meses que sigue la tendencia (D).

### P52 · dificultad 2 · kc: correlacion-regresion · borrador · origen: ia (sonnet-5.5)
En un centro de datos se registraron 12 meses de datos. El número de tickets de soporte abiertos al mes y la CPU promedio del servidor de correo dan un coeficiente de correlación r = 0,95. Un analista debe sacar una conclusión. ¿Cuál es la válida?

- A) Hay una asociación lineal fuerte y positiva, pero no prueba que una variable cause la otra: pueden depender de un factor común, como el número de usuarios · CORRECTA
- B) Los tickets provocan el aumento de la CPU, así que reducir los tickets bajará la CPU · [corr-correlacion-es-causa]
- C) Los tickets explican el 95 % de la variación de la CPU · [corr-r-como-porcentaje]
- D) La CPU provoca los tickets, porque los usuarios abren más tickets cuando el servidor va lento, y eso lo demuestra r = 0,95 · [corr-correlacion-es-causa] concluyes causalidad en el sentido contrario, sin más evidencia que el coeficiente

solución: r = 0,95 es cercano a 1, por lo que la relación lineal positiva es fuerte. Pero el coeficiente solo mide cuánto se mueven juntas las variables, no por qué. Los dos valores pueden crecer porque aumentan los usuarios, sin que uno cause el otro, así que ni B ni D son conclusiones válidas. Además r no es el porcentaje explicado: la variación explicada es r² = 0,95² ≈ 0,90, no 0,95 (C).

### P53 · dificultad 2 · kc: correlacion-regresion · borrador · origen: ia (sonnet-5.5)
Con los datos de los meses 1 a 8 se ajustó la recta T = 0,8 + 0,32·m, donde T es el tiempo de respuesta en segundos y m el número del mes. La gerencia fija 4 s como máximo aceptable. Estás al final del mes 8. ¿Cuántos meses más pasan hasta que la recta alcance el límite?

- A) 10 meses · [corr-indice-por-meses-faltantes]
- B) 4,5 meses · [corr-despeje-sin-intercepto]
- C) 7 meses · [corr-despeje-suma-intercepto]
- D) 2 meses · CORRECTA

solución: se despeja m en 4 = 0,8 + 0,32·m: m = (4 − 0,8)/0,32 = 3,2/0,32 = 10. La recta llega a 4 s en el mes 10; como ya van 8 meses, faltan 10 − 8 = 2. Si divides 4/0,32 = 12,5 sin restar el intercepto, faltarían 12,5 − 8 = 4,5 (B); si lo sumas, (4 + 0,8)/0,32 = 15 y faltarían 7 (C); y 10 es el número del mes, no los meses que faltan (A).

### P54 · dificultad 3 · kc: correlacion-regresion · borrador · origen: ia (sonnet-5.5)
Con 10 meses de datos se ajustaron dos modelos para el tiempo de respuesta T (en segundos). Con el uso de CPU: T = 0,5 + 0,05·CPU, con r = 0,96. Con el uso de RAM: r = 0,12. Hoy la CPU está en 58 % y sube 4 puntos porcentuales por mes. El límite de la gerencia es T = 4 s. ¿En cuántos meses desde hoy se alcanza el límite y qué variable conviene usar para proyectar?

- A) 5,5 meses; usar la CPU, porque su r = 0,96 indica una relación lineal fuerte · [corr-despeje-sin-intercepto]
- B) 3 meses; usar la CPU, porque su r = 0,96 indica una relación lineal fuerte · CORRECTA
- C) 8 meses; usar la CPU, porque su r = 0,96 indica una relación lineal fuerte · [corr-despeje-suma-intercepto]
- D) 3 meses; usar la RAM, porque su r = 0,12 está cerca de 0 y eso indica una relación fuerte · [corr-cercana-a-cero-es-fuerte]

solución: variable: la CPU tiene r = 0,96, cercano a 1, y la RAM r = 0,12, cercano a 0 (sin relación lineal apreciable), así que la CPU es la que sirve para proyectar. Uso de CPU en que T = 4: 4 = 0,5 + 0,05·CPU, CPU = (4 − 0,5)/0,05 = 70 %. Desde 58 % a 4 puntos por mes: (70 − 58)/4 = 3 meses. Sin restar el intercepto saldría CPU = 4/0,05 = 80 % y (80 − 58)/4 = 5,5 meses (A); sumándolo, (4 + 0,5)/0,05 = 90 % y (90 − 58)/4 = 8 meses (C). La RAM no sirve porque r cercano a 0 no es una relación fuerte (D).

### P55 · dificultad 1 · kc: correlacion-regresion · borrador · origen: ia (sonnet-5.5)
El espacio usado en un servidor de archivos sigue la recta Q = 40 + 10·m, con Q en GB y m el número del mes (el mes 1 es el primero con datos). La capacidad total es 100 GB. Estás en el mes 3. ¿Cuántos meses faltan para llenar el disco según la recta?

- A) 6 meses · [corr-indice-por-meses-faltantes]
- B) 7 meses · [corr-despeje-sin-intercepto]
- C) 3 meses · CORRECTA
- D) 11 meses · [corr-despeje-suma-intercepto]

solución: se despeja m en 100 = 40 + 10·m: m = (100 − 40)/10 = 6. El disco se llena en el mes 6; como van 3 meses, faltan 6 − 3 = 3. Dividir 100/10 = 10 ignora el intercepto y daría 10 − 3 = 7 (B); sumarlo, (100 + 40)/10 = 14 y 14 − 3 = 11 (D). El 6 es el número del mes, no los meses que faltan (A).

### P56 · dificultad 1 · kc: iops-latencia · borrador · origen: ia (sonnet-5.5)
El disco de un sistema de inventarios atiende en promedio 180 lecturas por segundo y 120 escrituras por segundo. Cada transacción implica en promedio 3 IOPS. ¿Cuáles son los IOPS totales y las transacciones por segundo?

- A) 180 IOPS y 60 transacciones por segundo · [iops-solo-lecturas]
- B) 300 IOPS y 100 transacciones por segundo · CORRECTA
- C) 150 IOPS y 50 transacciones por segundo · [iops-promedia-en-vez-de-sumar]
- D) 300 IOPS y 900 transacciones por segundo · [iops-transacciones-mal-convertidas]

solución: IOPS totales = lecturas + escrituras = 180 + 120 = 300. Cada transacción usa 3 IOPS, así que transacciones por segundo = 300 ÷ 3 = 100. Con solo las lecturas saldrían 180 y 60 (A); promediando, (180 + 120)/2 = 150 y 50 (C); multiplicar 300 × 3 = 900 invierte la conversión (D).

### P57 · dificultad 2 · kc: iops-latencia · borrador · origen: ia (sonnet-5.5)
Un disco SATA tiene un tiempo de servicio de 8 ms por operación, así que atiende como máximo 1000/8 = 125 operaciones por segundo. Una aplicación genera 90 transacciones por segundo y cada transacción implica 3 IOPS. ¿Puede el disco atender esa carga?

- A) Sí: 90 transacciones por segundo son menos que los 125 IOPS que ofrece el disco · [iops-transacciones-mal-convertidas] comparas transacciones con IOPS sin pasarlas a IOPS
- B) Sí: la aplicación pide 30 IOPS (90 ÷ 3), muy por debajo de 125 · [iops-transacciones-mal-convertidas]
- C) Sí: el disco ofrece 8.000 IOPS (8 × 1000), más que de sobra · [iops-capacidad-mal-convertida]
- D) No: la carga es de 270 IOPS (90 × 3) y el disco solo ofrece 125 · CORRECTA

solución: la carga en IOPS = transacciones por segundo × IOPS por transacción = 90 × 3 = 270. La capacidad del disco = 1000 ms / 8 ms = 125 IOPS. Como 270 > 125, el disco no alcanza (necesitaría más de 2 discos como este o uno más rápido). Comparar 90 con 125 (A) o dividir 90 ÷ 3 (B) usa mal la conversión, y 8 × 1000 = 8.000 (C) multiplica en vez de dividir.

### P58 · dificultad 2 · kc: iops-latencia · borrador · origen: ia (sonnet-5.5)
Se midieron lecturas y escrituras por segundo de un disco en tres días: día 1, 240 lecturas y 90 escrituras; día 2, 150 lecturas y 210 escrituras; día 3, 200 lecturas y 150 escrituras. Cada transacción implica 3 IOPS. ¿Qué día tuvo más IOPS totales y a cuántas transacciones por segundo equivale?

- A) Día 2, con 360 IOPS y 120 transacciones por segundo · CORRECTA
- B) Día 1, con 240 IOPS y 80 transacciones por segundo · [iops-solo-lecturas]
- C) Día 2, con 360 IOPS y 1.080 transacciones por segundo · [iops-transacciones-mal-convertidas]
- D) Día 2, con 180 IOPS y 60 transacciones por segundo · [iops-promedia-en-vez-de-sumar]

solución: IOPS totales = lecturas + escrituras. Día 1: 240 + 90 = 330. Día 2: 150 + 210 = 360. Día 3: 200 + 150 = 350. El día 2 es el mayor y sus transacciones por segundo son 360 ÷ 3 = 120. Mirando solo lecturas parecería ganar el día 1 (B); multiplicar 360 × 3 da 1.080 (C); promediar da 180 y 60 (D).

### P59 · dificultad 3 · kc: iops-latencia · borrador · origen: ia (sonnet-5.5)
Un disco tiene un tiempo de servicio de 5 ms por operación y recibe 150 IOPS. Con el criterio del curso (70 % de utilización como umbral de saturación de una controladora de disco), ¿qué porcentaje de su capacidad máxima usa y qué se espera del tiempo de respuesta?

- A) Usa 3 % de su capacidad (150 de 5.000 IOPS), así que el tiempo de respuesta es casi el de servicio · [iops-capacidad-mal-convertida]
- B) Usa 75 %, pero 150 IOPS es un valor alto y eso indica buen desempeño, sin necesidad de vigilar la latencia · [iops-alto-es-bueno]
- C) Usa 75 %, por encima del 70 %; con la cola el tiempo de respuesta ronda 20 ms, cuatro veces el de servicio · CORRECTA
- D) Usa 75 %, y el tiempo de respuesta es 75 % mayor que el de servicio, unos 8,75 ms · [iops-latencia-proporcional]

solución: capacidad máxima = 1000/5 = 200 IOPS. Uso = 150/200 = 0,75 = 75 %, por encima del umbral de 70 %. Con U = 0,75, el tiempo de respuesta es R = Rs/(1 − U) = 5/0,25 = 20 ms, cuatro veces el tiempo de servicio. La latencia no crece en proporción a la carga: cerca del límite se dispara (D). Un IOPS alto no es señal de buen desempeño si ya hay riesgo de saturación (B), y 5 × 1000 = 5.000 es una conversión al revés (A).

### P60 · dificultad 1 · kc: iops-latencia · borrador · origen: ia (sonnet-5.5)
Un disco de un sistema de historias clínicas tiene un tiempo de servicio de 6 ms y hoy opera al 40 % de su capacidad de IOPS, con un tiempo de respuesta de 10 ms. Al abrir una nueva sede se espera que la carga se duplique (80 % de la capacidad), sobre todo con escrituras. ¿Qué tiempo de respuesta se espera?

- A) Unos 20 ms, porque la latencia crece en proporción a la carga · [iops-latencia-proporcional]
- B) Unos 10 ms: atender el doble de IOPS muestra que el disco rinde bien y la latencia no es motivo de preocupación · [iops-alto-es-bueno]
- C) Unos 30 ms: cerca del límite la cola crece más rápido que la carga y el tiempo se triplica · CORRECTA
- D) Casi lo mismo, porque la carga nueva es de escrituras y solo las lecturas influyen en el tiempo de respuesta · [iops-solo-lecturas] ignoras las escrituras al medir la carga del disco

solución: con R = Rs/(1 − U), hoy R = 6/(1 − 0,4) = 10 ms, que coincide con lo medido. Al 80 %: R = 6/(1 − 0,8) = 6/0,2 = 30 ms, el triple. La carga se duplica pero la latencia se triplica, porque la cola crece más rápido que la carga (A supone una relación lineal y daría 20 ms). Que el disco atienda más IOPS solo indica actividad, no buen desempeño (B), y las lecturas y las escrituras cuentan igual en la carga del disco (D).

### P61 · dificultad 1 · kc: leyes-operacionales · borrador · origen: ia (sonnet-5.5)
Un servidor de disco recibe a = 50 peticiones por segundo y su tiempo de servicio es Rs = 15 ms. Con el criterio del curso para la controladora de disco, ¿cuál es la utilización y está saturado?

- A) U = 750 %, saturado · [leyes-ms-con-s]
- B) U = 75 %, saturado porque supera el umbral de 70 % · CORRECTA
- C) U = 7,5 %, lejos de saturarse · [leyes-coma-corrida]
- D) U = 75 %, no saturado porque el umbral es 80 % · [leyes-umbral-80]

solución: se pasa Rs a segundos: 15 ms = 0,015 s. U = a·Rs = 50 × 0,015 = 0,75 = 75 %. El curso toma 70 % como umbral de saturación de la controladora, así que 75 % lo supera. Si se usa 15 sin convertir, 50 × 15 = 750 (A); si se corre la coma sale 7,5 % (C); y el umbral no es 80 % (D).

### P62 · dificultad 2 · kc: leyes-operacionales · borrador · origen: ia (sonnet-5.5)
Un servidor recibe a = 60 peticiones por segundo y su tiempo de servicio es Rs = 8 ms. ¿Cuáles son el tiempo de respuesta R y el número de peticiones en el sistema N?

- A) R ≈ 15,4 ms y N ≈ 0,92 peticiones · CORRECTA
- B) R ≈ 154 ms y N ≈ 9,2 peticiones · [leyes-coma-corrida]
- C) R ≈ 16,7 ms y N = 1,0 petición · [leyes-divide-por-u]
- D) R ≈ 15,4 ms y N ≈ 3.900 peticiones · [leyes-little-dividida]

solución: Rs = 0,008 s. U = a·Rs = 60 × 0,008 = 0,48. R = Rs/(1 − U) = 0,008/0,52 ≈ 0,01538 s ≈ 15,4 ms. Ley de Little: N = a·R = 60 × 0,01538 ≈ 0,92. Dividir Rs entre U (0,008/0,48 ≈ 16,7 ms) olvida el 1 − U (C); correr la coma da 154 ms (B); y 60/0,01538 ≈ 3.900 divide en vez de multiplicar (D).

### P63 · dificultad 2 · kc: leyes-operacionales · borrador · origen: ia (sonnet-5.5)
Dos nodos de almacenamiento de un servicio de facturación reciben la misma carga, a = 45 peticiones por segundo. El nodo A tiene un tiempo de servicio de 17 ms y el B de 13 ms. Con la ley de Little el equipo midió N ≈ 3,26 peticiones en A y N ≈ 1,41 en B. Con el criterio del curso (70 % de utilización como umbral de saturación), ¿cuál está más cerca de saturarse?

- A) El B, porque A tiene mayor N y por eso le caben más peticiones antes de saturarse · [leyes-mayor-n-menos-riesgo]
- B) Ninguno: A tiene 76,5 % y B 58,5 %, y los dos están por debajo del 80 % de saturación · [leyes-umbral-80]
- C) Los dos están saturados, porque con Rs en milisegundos U vale 765 para A y 585 para B · [leyes-ms-con-s]
- D) El A: su utilización es 76,5 %, que supera el 70 %, mientras que B está en 58,5 % · CORRECTA

solución: U_A = a·Rs = 45 × 0,017 = 0,765 y U_B = 45 × 0,013 = 0,585. El riesgo de saturación se mide con U: A supera el umbral de 70 % y B no. Un mayor N va de la mano de una mayor U (N = U/(1 − U): 0,765/0,235 ≈ 3,26 y 0,585/0,415 ≈ 1,41), así que el N de A es señal de más ocupación y no de más holgura (A). El umbral del curso es 70 % y no 80 % (B), y hay que pasar 17 ms a 0,017 s y 13 ms a 0,013 s antes de multiplicar (C).

### P64 · dificultad 3 · kc: leyes-operacionales · borrador · origen: ia (sonnet-5.5)
Un disco con tiempo de servicio Rs = 7 ms recibe 90 peticiones por segundo, y se espera que la demanda crezca 20 %. Con la nueva tasa, ¿cuáles son la utilización y el tiempo de respuesta, y se supera el umbral de saturación del curso para la controladora de disco?

- A) U = 75,6 % y R ≈ 287 ms; se supera el umbral · [leyes-coma-corrida]
- B) U = 75,6 % y R ≈ 9,3 ms; se supera el umbral · [leyes-divide-por-u]
- C) U = 75,6 % y R ≈ 28,7 ms; pero no hay riesgo, porque falta para llegar a 80 % · [leyes-umbral-80]
- D) U = 75,6 % y R ≈ 28,7 ms; se supera el umbral de 70 % · CORRECTA

solución: la nueva tasa es a = 90 × 1,2 = 108 peticiones por segundo. U = 108 × 0,007 = 0,756 = 75,6 %. R = Rs/(1 − U) = 0,007/0,244 ≈ 0,0287 s ≈ 28,7 ms (antes, con U = 63 %, eran unos 18,9 ms). Como el umbral del curso es 70 %, 75,6 % lo supera. Dividir 7/0,756 ≈ 9,3 ms usa U en vez de 1 − U (B); correr la coma da 287 ms (A); y el umbral no es 80 % (C).

### P65 · dificultad 1 · kc: leyes-operacionales · borrador · origen: ia (sonnet-5.5)
Dos servidores reciben a = 60 peticiones por segundo. Con la ley de Little se calculó N = 3,0 peticiones en el sistema X y N = 1,1 en el Y. ¿Cuáles son los tiempos de respuesta y cuál servidor está más cerca de saturarse?

- A) R_X = 500 ms y R_Y = 183 ms; el más cerca es X · [leyes-coma-corrida]
- B) R_X = 50 ms y R_Y ≈ 18,3 ms; el más cerca es X, porque con la misma tasa un mayor N indica más ocupación · CORRECTA
- C) R_X = 50 ms y R_Y ≈ 18,3 ms; el más cerca es Y, porque X tiene mayor N y le caben más peticiones antes de saturarse · [leyes-mayor-n-menos-riesgo]
- D) R_X = 20 s y R_Y ≈ 54,5 s; el más cerca es Y, que es el más lento · [leyes-little-dividida]

solución: de N = a·R se despeja R = N/a. X: R = 3,0/60 = 0,05 s = 50 ms. Y: R = 1,1/60 ≈ 0,0183 s ≈ 18,3 ms. Con la misma a, un mayor N significa mayor R y mayor utilización, así que X está más cerca de saturarse. Que haya más peticiones dentro del sistema no da más holgura (C); R = a/N (D) divide al revés, y 0,05 s no son 500 ms (A).

### P66 · dificultad 1 · kc: speedup · borrador · origen: ia (sonnet-5.5)
Una tarea de generación de reportes tarda 0,12 s en la configuración original y 40 ms en la nueva. ¿Cuál es el speedup de la nueva respecto a la original?

- A) 0,33 · [speedup-invertido]
- B) 0,003 · [speedup-unidades-mezcladas]
- C) 3 · CORRECTA
- D) 0,08 · [speedup-resta-tiempos]

solución: se pasan los dos tiempos a la misma unidad: 40 ms = 0,04 s. Speedup = T_lento/T_rápido = 0,12/0,04 = 3: la nueva es 3 veces más rápida. Si se divide al revés sale 0,33 (A); si se divide 0,12 entre 40 sin convertir, 0,003 (B); y restar da 0,12 − 0,04 = 0,08 s, que es una diferencia de tiempo y no un speedup (D).

### P67 · dificultad 2 · kc: speedup · borrador · origen: ia (sonnet-5.5)
Una arquitectura A procesa una transacción en 72 ms y una arquitectura B en 30 ms. Si A, atendiendo varias transacciones a la vez, procesa 1.500 por minuto, ¿cuántas procesaría B suponiendo proporcionalidad directa con el speedup?

- A) 3.600 transacciones por minuto · CORRECTA
- B) 625 transacciones por minuto · [speedup-throughput-dividido]
- C) 1.502,4 transacciones por minuto · [speedup-throughput-sumado]
- D) 63.000 transacciones por minuto · [speedup-resta-tiempos]

solución: speedup de B respecto a A = T_lento/T_rápido = 72/30 = 2,4. Nuevo throughput = 1.500 × 2,4 = 3.600 por minuto. Dividir 1.500/2,4 = 625 reduce el throughput (B); sumar 1.500 + 2,4 = 1.502,4 trata el speedup como si fueran transacciones (C); y usar la resta 72 − 30 = 42 como factor da 1.500 × 42 = 63.000 (D).

### P68 · dificultad 2 · kc: speedup · borrador · origen: ia (sonnet-5.5)
Un respaldo nocturno tarda 2,5 minutos con la configuración actual y 90 segundos con la nueva. ¿Cuál es el speedup de la nueva respecto a la actual?

- A) 0,6 · [speedup-invertido]
- B) 0,03 · [speedup-unidades-mezcladas]
- C) 60 · [speedup-resta-tiempos]
- D) 1,67 · CORRECTA

solución: 2,5 min = 150 s. Speedup = T_lento/T_rápido = 150/90 ≈ 1,67. Dividir 90/150 = 0,6 invierte el cociente (A); dividir 2,5/90 ≈ 0,03 mezcla minutos con segundos (B); y 150 − 90 = 60 s es una resta de tiempos, no el speedup (C).

### P69 · dificultad 2 · kc: speedup · borrador · origen: ia (sonnet-5.5)
Una configuración original procesa un lote en 50 ms y una propuesta nueva lo hace en 0,0625 s. El speedup se define como el tiempo de la original dividido por el tiempo de la nueva. ¿Cuánto vale y qué indica?

- A) 1,25: la nueva es 1,25 veces más rápida · [speedup-invertido]
- B) 0,8: la nueva es más lenta que la original · CORRECTA
- C) 12,5: la nueva mejora el lote en 12,5 ms · [speedup-resta-tiempos]
- D) 800: la nueva es 800 veces más rápida · [speedup-unidades-mezcladas]

solución: 0,0625 s = 62,5 ms. Speedup = T_original/T_nueva = 50/62,5 = 0,8. Un valor menor que 1 significa que la propuesta tarda más que la original, es decir, empeora. Dividir al revés da 1,25 (A); restar 62,5 − 50 = 12,5 da una diferencia de tiempo (C); y 50/0,0625 = 800 mezcla milisegundos con segundos (D).

### P70 · dificultad 3 · kc: speedup · borrador · origen: ia (sonnet-5.5)
Una configuración A tarda 80 ms por tarea y, atendiendo varias a la vez, procesa 1.800 tareas por minuto. Una configuración B tarda 32 ms por tarea. Suponiendo proporcionalidad directa con el speedup, ¿cuántas tareas por segundo procesará B?

- A) 12 tareas por segundo · [speedup-throughput-dividido]
- B) 4.500 tareas por segundo · [speedup-unidades-mezcladas] dejas el throughput en tareas por minuto y lo llamas por segundo
- C) 75 tareas por segundo · CORRECTA
- D) 30 tareas por segundo · [speedup-throughput-sumado]

solución: speedup = T_lento/T_rápido = 80/32 = 2,5. Throughput de B = 1.800 × 2,5 = 4.500 tareas por minuto; en segundos son 4.500/60 = 75. Dividir 1.800/2,5 = 720 por minuto son 12 por segundo (A); dejar 4.500 sin pasar de minutos a segundos (B); y sumar 1.800 + 2,5 = 1.802,5 por minuto son cerca de 30 por segundo (D).
