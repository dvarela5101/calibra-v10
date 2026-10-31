# Disponibilidad y RAID

Disponibilidad de componentes y de configuraciones RAID. Es del Parcial 4.

## Habilidades
kc: disponibilidad-mtbf · Calcular la disponibilidad de un componente con MTBF y MTTR y pasarla a horas o minutos sin servicio al mes o al año
kc: disponibilidad-serie-paralelo · Calcular la disponibilidad de componentes en serie, en paralelo y combinados, y decidir si una redundancia vale la pena · prerrequisitos: disponibilidad-mtbf
kc: raid · Calcular la disponibilidad de RAID 0, 1, 5, 0+1 y 1+0 y elegir el RAID que cumple un requisito de IOPS, disponibilidad y costo (penalidad de escritura incluida) · prerrequisitos: disponibilidad-serie-paralelo, iops-latencia

## Errores
mc: dm-mtbf-entre-mttr · disponibilidad-mtbf · calculas MTBF/MTTR en vez de MTBF/(MTBF + MTTR)
mc: dm-confunde-disp-indisp · disponibilidad-mtbf · usas la indisponibilidad donde va la disponibilidad, o al revés, por ejemplo multiplicas D por las horas del periodo y lo tomas como horas sin servicio
mc: dm-periodo-equivocado · disponibilidad-mtbf · usas las horas de otro periodo, como 8.760 h en una pregunta mensual o 730 h en una anual
mc: dm-no-pasa-a-horas · disponibilidad-mtbf · dejas la indisponibilidad como porcentaje sin multiplicarla por las horas del periodo
mc: dm-unidades-mezcladas · disponibilidad-mtbf · sumas MTBF y MTTR sin igualar unidades, mezclando horas con minutos o con días
mc: dm-compara-por-mtbf · disponibilidad-mtbf · eliges el componente con mayor MTBF sin mirar su MTTR
mc: sp-serie-y-paralelo-intercambiados · disponibilidad-serie-paralelo · aplicas la regla de serie en un bloque en paralelo (multiplicas las disponibilidades) o la de paralelo en uno en serie
mc: sp-suma-o-promedia · disponibilidad-serie-paralelo · sumas o promedias las disponibilidades de los componentes en vez de combinarlas con la regla de serie o de paralelo
mc: sp-omite-componente · disponibilidad-serie-paralelo · dejas fuera del cálculo un componente del diagrama, por ejemplo el que va en serie con el bloque redundante
mc: sp-olvida-horas-periodo · disponibilidad-serie-paralelo · no conviertes la indisponibilidad a las horas del periodo y comparas porcentajes sueltos
mc: sp-decide-por-intuicion · disponibilidad-serie-paralelo · decides sobre una mejora o una redundancia sin recalcular la disponibilidad total ni pasarla a horas o a costo
mc: rd-raid0-mejora-disponibilidad · raid · crees que RAID 0 mejora la disponibilidad porque reparte los datos entre varios discos
mc: rd-olvida-penalidad-raid5 · raid · olvidas la penalidad de escritura (4 operaciones por escritura en RAID 5, 2 en RAID 1) y cuentas solo las operaciones de la aplicación
mc: rd-espejo-sin-presupuesto · raid · eliges RAID 1 o RAID 10 aunque el presupuesto no permite duplicar la capacidad
mc: rd-penalidad-en-lecturas · raid · aplicas la penalidad de escritura también a las lecturas, o descartas RAID 5 por la penalidad aunque casi no se escribe
mc: rd-0mas1-igual-1mas0 · raid · crees que RAID 0+1 y RAID 1+0 tienen la misma disponibilidad
mc: rd-redundancia-como-serie · raid · calculas la disponibilidad de un espejo o de un RAID 5 como si todos los discos tuvieran que funcionar, multiplicando sus disponibilidades

## Preguntas

### P86 · dificultad 1 · kc: disponibilidad-mtbf · borrador · origen: ia (sonnet-5.5)
Un conmutador de red tiene un MTBF de 1.200 horas y un MTTR de 90 minutos. ¿Cuál es su disponibilidad?

- A) 93,02 % · [dm-unidades-mezcladas]
- B) 0,12 % · [dm-confunde-disp-indisp]
- C) 80.000 % (MTBF/MTTR = 800) · [dm-mtbf-entre-mttr]
- D) 99,88 % · CORRECTA

solución: se pasa el MTTR a horas: 90 min = 1,5 h. D = MTBF/(MTBF + MTTR) = 1.200/1.201,5 = 0,99875, es decir 99,88 %. Sumar 1.200 + 90 sin convertir da 93,02 %; MTBF/MTTR = 800 no es una disponibilidad; y MTTR/(MTBF + MTTR) = 0,12 % es la indisponibilidad.

### P87 · dificultad 2 · kc: disponibilidad-mtbf · borrador · origen: ia (sonnet-5.5)
Un servidor tiene un MTBF de 380 horas y un MTTR de 2 horas. ¿Cuántas horas al mes estará sin servicio, tomando 730 horas por mes?

- A) 726,18 h · [dm-confunde-disp-indisp]
- B) 3,82 h · CORRECTA
- C) 45,86 h · [dm-periodo-equivocado]
- D) 0,52 h · [dm-no-pasa-a-horas]

solución: D = 380/382 = 0,99476. Indisponibilidad = 1 − D = 2/382 = 0,005236. Horas sin servicio al mes = 0,005236 × 730 = 3,82 h. Multiplicar D por 730 da 726,18 h (horas con servicio); usar 8.760 da 45,86 h (es el valor anual); dejar 0,52 % como si fueran horas da 0,52 h.

### P88 · dificultad 2 · kc: disponibilidad-mtbf · borrador · origen: ia (sonnet-5.5)
El componente A tiene MTBF = 800 h y MTTR = 25 h. El componente B tiene MTBF = 3.000 h y MTTR = 150 h. ¿Cuál es más disponible y con qué valor?

- A) El B, porque falla con menos frecuencia (su MTBF es mayor) · [dm-compara-por-mtbf]
- B) El B, con 4,76 % frente a 3,03 % del A · [dm-confunde-disp-indisp]
- C) El A, con 96,97 % frente a 95,24 % del B · CORRECTA
- D) El A, con 3.200 % frente a 2.000 % del B · [dm-mtbf-entre-mttr]

solución: D(A) = 800/825 = 0,9697 (96,97 %). D(B) = 3.000/3.150 = 0,9524 (95,24 %). El A es más disponible aunque su MTBF sea menor, porque su reparación es mucho más corta en proporción. 4,76 % y 3,03 % son las indisponibilidades (la mayor es la peor), y 32 y 20 son cocientes MTBF/MTTR, no disponibilidades.

### P89 · dificultad 3 · kc: disponibilidad-mtbf · borrador · origen: ia (sonnet-5.5)
Un servidor tiene MTBF = 45 días y MTTR = 6 horas. El contrato admite como máximo 20 horas sin servicio al año (8.760 h). ¿Qué cálculo y conclusión son correctos?

- A) Se pasan los 45 días a 1.080 h: D = 1.080/1.086 = 99,45 %, lo que da 48,40 h sin servicio al año; no cumple · CORRECTA
- B) Con 45 y 6 sin convertir: D = 45/51 = 88,24 %, lo que da 1.030,6 h sin servicio al año; no cumple · [dm-unidades-mezcladas]
- C) D = 99,45 % y 0,9945 × 8.760 = 8.711,6 h sin servicio al año; no cumple · [dm-confunde-disp-indisp]
- D) La indisponibilidad es 6/1.086 = 0,55 %; como 0,55 es menor que 20, cumple · [dm-no-pasa-a-horas]

solución: 45 días × 24 = 1.080 h. D = 1.080/1.086 = 0,99448. Indisponibilidad = 6/1.086 = 0,005525. Horas sin servicio al año = 0,005525 × 8.760 = 48,40 h, mayor que 20 h, así que no cumple. Sin convertir los días se obtienen 1.030,6 h; multiplicar D por las horas da las horas con servicio (8.711,6 h); y comparar 0,55 % con 20 h mezcla un porcentaje con horas.

### P90 · dificultad 3 · kc: disponibilidad-mtbf · borrador · origen: ia (sonnet-5.5)
El disco A tiene MTBF = 50.000 h y MTTR = 500 h. El disco B tiene MTBF = 20.000 h y MTTR = 40 h. ¿Cuál tiene menos horas sin servicio al mes (730 h) y cuántas?

- A) El B, con 17,49 h · [dm-periodo-equivocado]
- B) El A, con 7,23 h, porque su MTBF es mayor · [dm-compara-por-mtbf]
- C) El B, con 1,46 h · CORRECTA
- D) El B, con 728,54 h · [dm-confunde-disp-indisp]

solución: indisponibilidad de A = 500/50.500 = 0,009901, es decir 7,23 h al mes. Indisponibilidad de B = 40/20.040 = 0,001996, es decir 0,001996 × 730 = 1,46 h al mes. B tiene menos horas sin servicio aunque su MTBF sea menor. Usar 8.760 h da 17,49 h (anual) y multiplicar D por 730 da 728,54 h (horas con servicio).

### P91 · dificultad 1 · kc: disponibilidad-serie-paralelo · borrador · origen: ia (sonnet-5.5)
Una aplicación necesita, en serie, un servidor web (98 %), un servidor de aplicación (97 %) y una base de datos (95 %). ¿Cuál es la disponibilidad del conjunto?

- A) 96,67 % · [sp-suma-o-promedia]
- B) 99,997 % · [sp-serie-y-paralelo-intercambiados]
- C) 90,31 % · CORRECTA
- D) 95,06 % · [sp-omite-componente]

solución: en serie se multiplican: 0,98 × 0,97 × 0,95 = 0,9031 (90,31 %). Promediar da 96,67 %; usar la fórmula de paralelo 1 − 0,02·0,03·0,05 da 99,997 %; y 0,98 × 0,97 = 95,06 % deja por fuera la base de datos.

### P92 · dificultad 2 · kc: disponibilidad-serie-paralelo · borrador · origen: ia (sonnet-5.5)
Dos servidores de réplica trabajan en paralelo; uno tiene 92 % de disponibilidad y el otro 88 %. ¿Cuántas horas al mes (730 h) está sin servicio el conjunto?

- A) 7,01 h · CORRECTA
- B) 138,99 h · [sp-serie-y-paralelo-intercambiados]
- C) 73,0 h · [sp-suma-o-promedia]
- D) 0,96 h · [sp-olvida-horas-periodo]

solución: en paralelo, D = 1 − (1 − 0,92)(1 − 0,88) = 1 − 0,08 × 0,12 = 0,9904. Indisponibilidad = 0,0096. Horas al mes = 0,0096 × 730 = 7,01 h. Multiplicar 0,92 × 0,88 (regla de serie) da 80,96 % y 138,99 h; promediar da 90 % y 73 h; y dejar 0,96 % sin convertir da 0,96 h.

### P93 · dificultad 2 · kc: disponibilidad-serie-paralelo · borrador · origen: ia (sonnet-5.5)
Una conexión usa un enlace principal (97 %) y uno de respaldo (90 %) en paralelo, seguidos de un enrutador (99 %) y un cortafuegos (98 %) en serie. ¿Cuál es la disponibilidad total?

- A) 84,70 % · [sp-serie-y-paralelo-intercambiados]
- B) 96,00 % · [sp-suma-o-promedia]
- C) 99,70 % · [sp-omite-componente]
- D) 96,73 % · CORRECTA

solución: el bloque paralelo vale 1 − 0,03 × 0,10 = 0,997. Ese bloque va en serie con el enrutador y el cortafuegos: 0,997 × 0,99 × 0,98 = 0,9673 (96,73 %). Multiplicar los cuatro valores como si todo fuera serie da 84,70 %; promediarlos da 96,00 %; y dar solo el bloque paralelo deja por fuera el enrutador y el cortafuegos (99,70 %).

### P94 · dificultad 3 · kc: disponibilidad-serie-paralelo · borrador · origen: ia (sonnet-5.5)
Una pasarela de pagos corre en un solo servidor con 97 % de disponibilidad (8.760 h al año). Cada hora sin servicio cuesta 100 USD en ventas perdidas. Una réplica idéntica en paralelo costaría 12.000 USD al año. ¿Qué conclusión es correcta?

- A) No vale la pena: con la réplica la disponibilidad baja a 94,09 % (0,97 × 0,97) y se pierden más horas · [sp-serie-y-paralelo-intercambiados]
- B) Sí vale la pena: la disponibilidad sube a 99,91 % y se evitan unos 25.491 USD de pérdidas al año, más que el costo · CORRECTA
- C) No vale la pena: la disponibilidad sube menos de tres puntos porcentuales, muy poco para gastar 12.000 USD · [sp-decide-por-intuicion]
- D) No vale la pena: la indisponibilidad baja de 0,03 a 0,0009 horas al año, un ahorro de 2,91 USD · [sp-olvida-horas-periodo]

solución: sin réplica, 0,03 × 8.760 = 262,8 h sin servicio, es decir 26.280 USD. Con réplica en paralelo, D = 1 − 0,03 × 0,03 = 0,9991, y 0,0009 × 8.760 = 7,884 h, es decir 788,4 USD. El ahorro es 26.280 − 788,4 = 25.491,6 USD, mayor que los 12.000 USD de la réplica, así que vale la pena. Multiplicar da 94,09 % (regla equivocada); juzgar por los puntos porcentuales sin pasarlos a horas y dinero lleva a descartarla; y tomar 0,0291 como horas da un ahorro de 2,91 USD.

### P95 · dificultad 3 · kc: disponibilidad-serie-paralelo · borrador · origen: ia (sonnet-5.5)
Dos componentes redundantes trabajan en paralelo: A con 85 % y B con 92 % de disponibilidad. Hay presupuesto para subir un punto porcentual a uno solo de los dos. ¿Cuál conviene mejorar?

- A) El A, por ser el más débil: es el que más aporta al conjunto · [sp-decide-por-intuicion]
- B) El A, porque 0,86 × 0,92 = 79,12 % supera a 0,85 × 0,93 = 79,05 % · [sp-serie-y-paralelo-intercambiados]
- C) Da igual: en ambos casos el conjunto sube un punto porcentual · [sp-suma-o-promedia]
- D) El B: el conjunto queda en 98,95 %, frente a 98,88 % si se mejora el A · CORRECTA

solución: al mejorar el A (86 %): 1 − 0,14 × 0,08 = 0,9888. Al mejorar el B (93 %): 1 − 0,15 × 0,07 = 0,9895. Conviene mejorar el B: en paralelo, la indisponibilidad es el producto de las de cada componente, y bajar la del componente más confiable multiplica por una indisponibilidad mayor del otro, por lo que reduce más el producto. Comparar con la regla de serie (79,12 % y 79,05 %), asumir que se sube un punto o reforzar por intuición el más débil llevan a otra conclusión.

### P96 · dificultad 1 · kc: raid · borrador · origen: ia (sonnet-5.5)
Con discos idénticos, ¿cuál afirmación sobre disponibilidad es correcta?

- A) RAID 0 tiene menos disponibilidad que un solo disco, y RAID 1 tiene más · CORRECTA
- B) RAID 0 mejora la disponibilidad respecto a un solo disco porque reparte los datos entre varios discos · [rd-raid0-mejora-disponibilidad]
- C) RAID 1 tiene menos disponibilidad que un solo disco, porque necesita que sus dos discos funcionen · [rd-redundancia-como-serie]
- D) Si el presupuesto no alcanza para duplicar la capacidad, RAID 1 o RAID 10 siguen siendo la elección adecuada para ganar disponibilidad · [rd-espejo-sin-presupuesto]

solución: RAID 0 falla si falla cualquier disco, así que su disponibilidad es el producto de las de los discos y queda por debajo de la de uno solo. RAID 1 solo falla si fallan todos sus discos (1 − ∏(1 − Di)), por lo que supera a un disco solo. Pero duplicar la capacidad cuesta, y cuando el presupuesto no lo permite hay que buscar otra opción, como RAID 5.

### P97 · dificultad 2 · kc: raid · borrador · origen: ia (sonnet-5.5)
Cuatro discos de 92 % de disponibilidad cada uno forman un RAID 1+0: dos espejos de dos discos, combinados en RAID 0. ¿Cuál es la disponibilidad del conjunto?

- A) 97,64 % · [rd-0mas1-igual-1mas0]
- B) 71,64 % · [rd-redundancia-como-serie]
- C) 98,72 % · CORRECTA
- D) 99,996 % · [rd-raid0-mejora-disponibilidad]

solución: cada espejo vale 1 − 0,08² = 0,9936. Los dos espejos van en RAID 0, que necesita ambos: 0,9936² = 0,9872 (98,72 %). El RAID 0+1 con los mismos discos da 97,64 %: cada franja vale 0,92² = 0,8464 y el espejo de dos franjas 1 − 0,1536² = 0,9764. Multiplicar los cuatro discos da 71,64 %, y tratar también el RAID 0 como mejora da 99,996 %.

### P98 · dificultad 2 · kc: raid · borrador · origen: ia (sonnet-5.5)
Una aplicación genera 600 IOPS, mitad lecturas y mitad escrituras. Cada disco ofrece 100 IOPS y se necesita tolerar la falla de un disco. ¿Cuál es la configuración con menos discos que soporta la carga?

- A) RAID 5 con 6 discos · [rd-olvida-penalidad-raid5]
- B) RAID 1+0 con 10 discos · CORRECTA
- C) RAID 0 con 6 discos · [rd-raid0-mejora-disponibilidad]
- D) RAID 1+0 con 12 discos · [rd-penalidad-en-lecturas] cobras 2 operaciones también por cada lectura

solución: lecturas = 300, escrituras = 300. En RAID 1+0 cada escritura cuesta 2: 300 + 2 × 300 = 900 operaciones en disco, que con 100 IOPS por disco requieren 9 discos, y como los espejos son de dos discos, 10. En RAID 5 cada escritura cuesta 4: 300 + 4 × 300 = 1.500, es decir 15 discos. Con 6 discos en RAID 5 solo hay 600 IOPS contra 1.500 necesarias; RAID 0 con 6 discos soporta la carga, pero no tolera ninguna falla; y 12 discos resulta de cobrar la penalidad también a las lecturas (2 × 600 = 1.200).

### P99 · dificultad 3 · kc: raid · borrador · origen: ia (sonnet-5.5)
Una base de datos transaccional genera 900 IOPS, con 40 % de lecturas y 60 % de escrituras. Hay hasta 12 discos disponibles, cada uno con 150 IOPS y 99 % de disponibilidad, y el presupuesto sí permite duplicar la capacidad. Se exige una disponibilidad de al menos 99,9 %. El RAID 1+0 se arma con seis espejos de dos discos y el RAID 0+1 con dos franjas de seis discos. ¿Qué configuración con los 12 discos cumple ambas exigencias?

- A) RAID 0 · [rd-raid0-mejora-disponibilidad]
- B) RAID 5 · [rd-olvida-penalidad-raid5]
- C) RAID 0+1 · [rd-0mas1-igual-1mas0]
- D) RAID 1+0 · CORRECTA

solución: lecturas = 360 y escrituras = 540. Con espejos (RAID 1+0 o 0+1), cada escritura cuesta 2: 360 + 2 × 540 = 1.440 ≤ 12 × 150 = 1.800, así que cumplen IOPS. Con RAID 5: 360 + 4 × 540 = 2.520 > 1.800, no cumple. Disponibilidad: RAID 1+0 son 6 espejos, cada uno 1 − 0,01² = 0,9999, y 0,9999⁶ = 99,94 %, que cumple. RAID 0+1 son 2 franjas de 6 discos: 0,99⁶ = 0,9415 cada una, y 1 − 0,0585² = 99,66 %, que no cumple. RAID 0 da 0,99¹² = 88,64 %. RAID 5 da 99,38 %. Solo RAID 1+0 cumple las dos exigencias.

### P100 · dificultad 1 · kc: raid · borrador · origen: ia (sonnet-5.5)
Una clínica monta el almacenamiento del correo y de los archivos compartidos de sus empleados. La carga es de 250 IOPS, de los cuales 20 % son escrituras. Dispone de 6 discos de 4 TB y 100 IOPS cada uno, no se compran más, y necesita al menos 16 TB útiles y sobrevivir a la falla de un disco. ¿Qué configuración conviene con esos 6 discos?

- A) RAID 0, porque con 6 discos ofrece 24 TB y reparte la carga, lo que también mejora la disponibilidad · [rd-raid0-mejora-disponibilidad]
- B) RAID 1+0, porque el espejo es la forma más segura de tolerar la falla de un disco · [rd-espejo-sin-presupuesto]
- C) RAID 5 con los 6 discos · CORRECTA
- D) RAID 5 no sirve: si cada operación cuesta 4, se necesitarían 250 × 4 = 1.000 IOPS y los discos solo dan 600 · [rd-penalidad-en-lecturas] cobras la penalidad de escritura también por cada lectura

solución: RAID 5 con 6 discos da (6 − 1) × 4 = 20 TB útiles, más que los 16 TB pedidos, y tolera la falla de un disco. Las operaciones en disco son 200 lecturas + 4 × 50 escrituras = 400, el 67 % de los 6 × 100 = 600 IOPS disponibles, por debajo del umbral de 70 %. RAID 0 no tolera ninguna falla y su disponibilidad es menor que la de un disco (A). RAID 1+0 con 6 discos deja solo 3 × 4 = 12 TB útiles, menos de los 16 TB que se necesitan, pues duplica la capacidad (B). La penalidad de 4 se cobra solo a las escrituras: cobrarla a todas las operaciones (1.000) es el error de D.
