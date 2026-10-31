# Planeación de capacidad

Requerimientos no funcionales, métricas, pruebas de carga y balanceo. Es del Parcial 4.

## Habilidades
kc: requerimientos-no-funcionales · Clasificar un requerimiento como de desempeño, disponibilidad, capacidad de procesamiento, capacidad de almacenamiento o escalabilidad, y distinguirlo de uno funcional
kc: metricas-y-pruebas · Elegir la métrica que cuantifica un requerimiento (utilización, Little, tiempo de respuesta, speedup, eficiencia, MTBF/MTTR) y distinguir carga real de sintética y evaluación comparativa de análisis de desempeño · prerrequisitos: requerimientos-no-funcionales, leyes-operacionales
kc: balanceo-de-carga · Explicar cómo reparten las peticiones de un cluster un balanceador (por origen, carga, capacidad o al azar) y el DNS (varias IP para un mismo dominio)

## Errores
mc: rnf-concurrencia-es-escalabilidad · requerimientos-no-funcionales · clasificas como escalabilidad una cifra de peticiones o usuarios simultáneos en temporada alta, cuando mide capacidad de procesamiento
mc: rnf-sedes-no-es-escalabilidad · requerimientos-no-funcionales · no reconoces como escalabilidad incorporar sedes, regiones o clientes nuevos sin cambiar la arquitectura y lo llevas a capacidad de procesamiento
mc: rnf-registros-no-es-almacenamiento · requerimientos-no-funcionales · clasificas el crecimiento de los registros de una base de datos como escalabilidad o desempeño en vez de capacidad de almacenamiento
mc: rnf-funcion-y-calidad-mezcladas · requerimientos-no-funcionales · confundes lo que el sistema hace con la calidad con que debe hacerlo y tomas como funcional una exigencia de calidad solo porque nombra una operación
mc: rnf-tiempo-respuesta-y-parada-mezclados · requerimientos-no-funcionales · cuando el requerimiento habla de tiempo, mezclas el tiempo de respuesta (desempeño) con el tiempo fuera de servicio (disponibilidad)
mc: rnf-cantidad-como-desempeno · requerimientos-no-funcionales · clasificas como desempeño una cifra de usuarios, operaciones o datos, cuando el desempeño habla de tiempos de respuesta
mc: mp-sintetica-es-real · metricas-y-pruebas · confundes la carga sintética con la carga real que generan los usuarios en producción
mc: mp-sintetica-es-maxima-fija · metricas-y-pruebas · crees que la carga sintética es siempre una carga máxima fija, sin ninguna variación
mc: mp-utilizacion-y-little-mezcladas · metricas-y-pruebas · mezclas la ley de utilización (qué tan ocupado está un recurso) con la ley de Little (cuántas peticiones hay en el sistema)
mc: mp-speedup-eficiencia-por-defecto · metricas-y-pruebas · eliges speedup o eficiencia apenas el enunciado habla de más servidores, aunque la pregunta no sea comparar tiempos con y sin más recursos
mc: mp-mtbf-y-mttr-mezclados · metricas-y-pruebas · confundes el tiempo medio entre fallas (MTBF) con el tiempo medio de reparación (MTTR)
mc: mp-comparativa-y-analisis-invertidos · metricas-y-pruebas · inviertes qué hace cada estudio: crees que la evaluación comparativa mira los componentes de una infraestructura y que el análisis de desempeño contrasta plataformas
mc: bc-solo-por-carga · balanceo-de-carga · crees que un balanceador reparte únicamente según la carga actual de los servidores
mc: bc-capacidad-es-carga · balanceo-de-carga · confundes la capacidad de un servidor (cuánto puede atender) con su carga (cuánto atiende en este momento)
mc: bc-sin-medir-no-es-balanceo · balanceo-de-carga · crees que repartir por origen, por capacidad fija o al azar no es balancear, porque no se mide el estado de los servidores
mc: bc-dns-reenvia · balanceo-de-carga · crees que el DNS recibe el tráfico del cliente y lo reenvía al servidor, como si fuera un intermediario
mc: bc-dns-lee-contenido · balanceo-de-carga · crees que el DNS decide leyendo el contenido de la petición o la ubicación del cliente
mc: bc-dns-conoce-carga · balanceo-de-carga · crees que el DNS sabe qué servidor está menos ocupado y responde con la IP de ese

## Preguntas

### P71 · dificultad 1 · kc: requerimientos-no-funcionales · borrador · origen: ia (sonnet-5.5)
Una plataforma de telemedicina define este requerimiento: «Durante la semana de vacunación, el sistema debe atender hasta 8.000 videoconsultas simultáneas». ¿Cómo se clasifica?

- A) Escalabilidad · [rnf-concurrencia-es-escalabilidad]
- B) Capacidad de procesamiento · CORRECTA
- C) Desempeño · [rnf-cantidad-como-desempeno]
- D) Requerimiento funcional · [rnf-funcion-y-calidad-mezcladas]

solución: la exigencia fija cuántas operaciones debe poder manejar el sistema al mismo tiempo en una temporada concreta. Eso es capacidad de procesamiento. No es escalabilidad, porque no habla de crecer sin cambiar la arquitectura; no es desempeño, porque no fija un tiempo de respuesta; y no es funcional, porque no dice qué hace el sistema sino cuánto debe aguantar.

### P72 · dificultad 2 · kc: requerimientos-no-funcionales · borrador · origen: ia (sonnet-5.5)
Una cadena de farmacias exige para su sistema de inventarios: «Debe poder incorporar seis sucursales nuevas por trimestre, en cualquier ciudad, sin rediseñar la arquitectura». ¿Cómo se clasifica?

- A) Capacidad de procesamiento · [rnf-sedes-no-es-escalabilidad]
- B) Desempeño · [rnf-cantidad-como-desempeno]
- C) Requerimiento funcional · [rnf-funcion-y-calidad-mezcladas]
- D) Escalabilidad · CORRECTA

solución: lo que se pide es que el sistema crezca (más sedes) sin cambiar su arquitectura, y eso es escalabilidad. No es capacidad de procesamiento, porque no fija una cifra de operaciones simultáneas; no es desempeño, porque no hay un tiempo de respuesta; y no es funcional, porque es una exigencia sobre cómo crece el sistema y no sobre una operación que ejecuta.

### P73 · dificultad 2 · kc: requerimientos-no-funcionales · borrador · origen: ia (sonnet-5.5)
El sistema de matrículas de una universidad guarda hoy 6 millones de filas en su base de datos, y se proyecta que lleguen a 18 millones en cuatro años. ¿Cómo se clasifica esa proyección como requerimiento?

- A) Capacidad de almacenamiento · CORRECTA
- B) Escalabilidad · [rnf-registros-no-es-almacenamiento]
- C) Desempeño · [rnf-cantidad-como-desempeno]
- D) Requerimiento funcional · [rnf-funcion-y-calidad-mezcladas]

solución: el crecimiento de los registros de la base es un asunto de cuánto espacio hay que tener, es decir, capacidad de almacenamiento. Aunque el volumen crece con el tiempo, no se pide que la arquitectura se adapte (escalabilidad); y una cifra de datos no es un tiempo de respuesta (desempeño) ni una operación del sistema (funcional).

### P74 · dificultad 3 · kc: requerimientos-no-funcionales · borrador · origen: ia (sonnet-5.5)
Un portal de inscripciones tiene estos tres requerimientos: (1) «El día de cierre debe registrar hasta 25.000 solicitudes concurrentes». (2) «Debe poder abrir un país nuevo cada trimestre sin cambiar la arquitectura». (3) «Su caída total en un año no debe sumar más de 5 horas». ¿Cuál clasificación, en ese orden, es correcta?

- A) (1) escalabilidad; (2) escalabilidad; (3) disponibilidad · [rnf-concurrencia-es-escalabilidad]
- B) (1) capacidad de procesamiento; (2) capacidad de procesamiento; (3) disponibilidad · [rnf-sedes-no-es-escalabilidad]
- C) (1) capacidad de procesamiento; (2) escalabilidad; (3) disponibilidad · CORRECTA
- D) (1) capacidad de procesamiento; (2) escalabilidad; (3) desempeño · [rnf-tiempo-respuesta-y-parada-mezclados]

solución: (1) es una cifra de solicitudes simultáneas en un día pico, por lo que es capacidad de procesamiento. (2) es crecer con países nuevos sin tocar la arquitectura, o sea escalabilidad. (3) limita el tiempo fuera de servicio, por lo que es disponibilidad: el desempeño habla de tiempo de respuesta, no de tiempo caído. Solo C acierta las tres.

### P75 · dificultad 1 · kc: requerimientos-no-funcionales · borrador · origen: ia (sonnet-5.5)
¿Cuál de los siguientes enunciados es un requerimiento de desempeño?

- A) «El sistema debe procesar 5.000 transacciones por segundo en hora pico.» · [rnf-cantidad-como-desempeno]
- B) «Cada consulta de saldo debe responderse en menos de 2 segundos.» · CORRECTA
- C) «La tabla de movimientos pasará de 9 a 25 millones de filas en tres años.» · [rnf-registros-no-es-almacenamiento]
- D) «El servicio no puede estar fuera de línea más de 3 horas al año.» · [rnf-tiempo-respuesta-y-parada-mezclados]

solución: el desempeño se expresa como tiempo de respuesta, y solo B fija uno (2 segundos por consulta). A es capacidad de procesamiento (operaciones por segundo), C es capacidad de almacenamiento (crecimiento de filas) y D es disponibilidad (tiempo fuera de servicio).

### P76 · dificultad 1 · kc: metricas-y-pruebas · borrador · origen: ia (sonnet-5.5)
Un banco recibe 40 solicitudes por segundo y cada una pasa en promedio 0,5 s dentro del sistema, contando la espera. Quiere saber cuántas solicitudes hay en el sistema al mismo tiempo, en promedio. ¿Qué métrica cuantifica ese requerimiento?

- A) Ley de utilización · [mp-utilizacion-y-little-mezcladas]
- B) Speedup · [mp-speedup-eficiencia-por-defecto]
- C) Ley de Little · CORRECTA
- D) MTTR (tiempo medio de reparación) · [mp-mtbf-y-mttr-mezclados]

solución: el número promedio de solicitudes en el sistema lo da la ley de Little: N = a·R = 40 × 0,5 = 20 solicitudes. La utilización mide qué tan ocupado está un recurso (U = a·S), el speedup compara tiempos con y sin mejora y el MTTR habla de reparaciones.

### P77 · dificultad 2 · kc: metricas-y-pruebas · borrador · origen: ia (sonnet-5.5)
Antes de salir a producción, un equipo escribe un guion que lanza 2.000 usuarios virtuales. Cada uno repite el flujo de compra con pausas aleatorias entre pasos, y la cantidad de usuarios activos sube y baja por franjas que el propio equipo definió. ¿Qué tipo de carga es esta?

- A) Sintética: se diseñó a propósito para simular condiciones de trabajo específicas · CORRECTA
- B) Real: los usuarios virtuales actúan como los usuarios de producción · [mp-sintetica-es-real]
- C) Máxima fija: lleva el sistema a su límite con un volumen constante · [mp-sintetica-es-maxima-fija]
- D) Ninguna: lo que se describe es un análisis de desempeño y no una carga · [mp-comparativa-y-analisis-invertidos]

solución: la carga la fabrica el equipo con un guion, así que es sintética. No es real porque no la generan personas usando el sistema; tampoco es una carga máxima fija, porque el guion varía (pausas aleatorias y franjas de usuarios). Y una carga es el insumo de una prueba, no un tipo de estudio como el análisis de desempeño.

### P78 · dificultad 2 · kc: metricas-y-pruebas · borrador · origen: ia (sonnet-5.5)
Un hospital debe elegir entre tres servidores candidatos. En cada uno ejecuta el mismo guion de 500 usuarios virtuales que repiten el flujo de admisiones, con pausas aleatorias y picos distintos por franja horaria, y luego compara los resultados. ¿Qué describe mejor lo que hace?

- A) Un análisis de desempeño con carga sintética · [mp-comparativa-y-analisis-invertidos]
- B) Una evaluación comparativa con carga real, porque los usuarios virtuales representan usuarios de verdad · [mp-sintetica-es-real]
- C) Una evaluación comparativa con carga máxima fija, sin variación · [mp-sintetica-es-maxima-fija]
- D) Una evaluación comparativa con carga sintética: el mismo guion artificial se aplica a plataformas distintas · CORRECTA

solución: se contrastan métricas de varias plataformas, lo que es una evaluación comparativa (el análisis de desempeño estudia el comportamiento de los componentes de una infraestructura concreta). La carga es sintética porque la construye el equipo, y no es máxima fija porque tiene variación (pausas aleatorias y picos por franja).

### P79 · dificultad 3 · kc: metricas-y-pruebas · borrador · origen: ia (sonnet-5.5)
Una aseguradora tiene tres necesidades: (1) saber cuántas peticiones hay a la vez en el sistema, en promedio, dadas la tasa de llegada y el tiempo de respuesta medido; (2) saber qué fracción de la mejora ideal obtiene al pasar de 1 a 8 servidores; (3) cuantificar cuánto tarda en promedio en volver a operar después de cada falla. ¿Qué métricas corresponden, en ese orden?

- A) Utilización, eficiencia, MTTR · [mp-utilizacion-y-little-mezcladas]
- B) Ley de Little, eficiencia, MTTR · CORRECTA
- C) Ley de Little, speedup, MTTR · [mp-speedup-eficiencia-por-defecto]
- D) Ley de Little, eficiencia, MTBF · [mp-mtbf-y-mttr-mezclados]

solución: (1) peticiones en el sistema: ley de Little (N = a·R); la utilización diría qué tan ocupado está el recurso, no cuántas peticiones hay. (2) la fracción de la mejora ideal es la eficiencia, E = speedup / número de servidores; el speedup solo da cuántas veces más rápido es. (3) el tiempo para volver a operar tras una falla es el MTTR; el MTBF es el tiempo entre fallas.

### P80 · dificultad 1 · kc: metricas-y-pruebas · borrador · origen: ia (sonnet-5.5)
Una planta quiere saber cada cuánto tiempo, en promedio, falla un equipo de refrigeración. ¿Qué métrica cuantifica ese requerimiento?

- A) Ley de utilización · [mp-utilizacion-y-little-mezcladas]
- B) MTTR (tiempo medio de reparación) · [mp-mtbf-y-mttr-mezclados]
- C) Speedup · [mp-speedup-eficiencia-por-defecto]
- D) MTBF (tiempo medio entre fallas) · CORRECTA

solución: lo que se pregunta es el intervalo promedio entre una falla y la siguiente, que es el MTBF. El MTTR mide cuánto tarda cada reparación, la utilización mide qué tan ocupado está un recurso y el speedup compara tiempos de ejecución.

### P81 · dificultad 1 · kc: balanceo-de-carga · borrador · origen: ia (sonnet-5.5)
Una tienda registra tres direcciones IP para el mismo nombre de dominio. Cuando un cliente consulta ese nombre, ¿qué hace el DNS?

- A) Responde con una de las tres direcciones IP registradas · CORRECTA
- B) Recibe la petición del cliente y la reenvía al servidor que elige · [bc-dns-reenvia]
- C) Lee el contenido de la petición y responde con la IP del servidor más adecuado para ese contenido · [bc-dns-lee-contenido]
- D) Mide qué servidor está menos ocupado y responde con su IP · [bc-dns-conoce-carga]

solución: el DNS solo traduce nombres a direcciones: mantiene varias IP para el dominio y entrega una en cada respuesta. No participa en el tráfico posterior (no reenvía), no mira el contenido de la petición y no conoce la carga de los servidores.

### P82 · dificultad 2 · kc: balanceo-de-carga · borrador · origen: ia (sonnet-5.5)
Un balanceador envía siempre al mismo servidor las peticiones que llegan desde una misma dirección IP, y a otros servidores las de otras direcciones. ¿En qué criterio se basa el reparto?

- A) La carga actual de cada servidor · [bc-solo-por-carga]
- B) La capacidad de cada servidor · [bc-capacidad-es-carga]
- C) El origen de la petición · CORRECTA
- D) Ninguno: sin medir el estado de los servidores no hay balanceo · [bc-sin-medir-no-es-balanceo]

solución: el servidor se decide por la dirección de donde viene la petición, así que el criterio es el origen. Un balanceador puede repartir por origen, por carga, por capacidad o al azar; que no mida el estado de los servidores no le quita el carácter de balanceador.

### P83 · dificultad 2 · kc: balanceo-de-carga · borrador · origen: ia (sonnet-5.5)
Un cluster tiene dos servidores: A con 16 núcleos y B con 4. El balanceador envía a A cuatro de cada cinco peticiones, sin consultar cuánto trabajo tiene cada servidor en ese momento. ¿En qué criterio se basa?

- A) La carga actual: A recibe más peticiones, así que es el más cargado · [bc-capacidad-es-carga]
- B) La capacidad de cada servidor · CORRECTA
- C) La carga actual: un balanceador siempre decide según cuál servidor está más libre · [bc-solo-por-carga]
- D) Ninguno: un reparto fijo de cuatro a una no es balanceo · [bc-sin-medir-no-es-balanceo]

solución: A tiene cuatro veces la capacidad de B (16 contra 4 núcleos) y recibe cuatro de cada cinco peticiones, proporcional a esa capacidad, sin mirar su carga del momento. Capacidad es lo que el servidor puede atender; carga es lo que atiende ahora.

### P84 · dificultad 3 · kc: balanceo-de-carga · borrador · origen: ia (sonnet-5.5)
Una empresa registra cuatro IP para su dominio. Un servidor se cae y, aun así, aproximadamente una de cada cuatro consultas de los clientes sigue recibiendo la IP del servidor caído. ¿Cuál explicación es correcta?

- A) El DNS reenvía el tráfico y falla al reenviar al servidor caído · [bc-dns-reenvia]
- B) El DNS lee el contenido de la petición y eligió un servidor inadecuado · [bc-dns-lee-contenido]
- C) El DNS mide la carga y cree que el servidor caído es el menos ocupado · [bc-dns-conoce-carga]
- D) El DNS solo mantiene las IP registradas y responde con una de ellas, sin comprobar el estado de cada servidor · CORRECTA

solución: con cuatro IP registradas, cada respuesta lleva una de ellas, por lo que una de cada cuatro consultas recibe la del servidor caído. El DNS no mide carga ni salud, no lee las peticiones y no reenvía tráfico; por eso no se entera de la caída.

### P85 · dificultad 1 · kc: balanceo-de-carga · borrador · origen: ia (sonnet-5.5)
Un balanceador asigna cada petición a un servidor escogido sin mirar ni al cliente ni a los servidores. ¿Qué criterio usa?

- A) Al azar · CORRECTA
- B) La carga de los servidores · [bc-solo-por-carga]
- C) La capacidad de los servidores · [bc-capacidad-es-carga]
- D) Ninguno: sin medir los servidores no es balanceo · [bc-sin-medir-no-es-balanceo]

solución: escoger un servidor sin usar ningún dato del cliente ni de los servidores es un reparto al azar. Es uno de los criterios válidos de un balanceador, junto con el origen, la carga y la capacidad.
