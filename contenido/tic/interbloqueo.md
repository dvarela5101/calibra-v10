# Interbloqueo

Condiciones de un interbloqueo y cómo evitarlo. Es del Parcial 3.

## Habilidades
kc: interbloqueo · Reconocer las condiciones de un interbloqueo y una forma de evitarlo, como en la cena de los filósofos · prerrequisitos: synchronized-monitor

## Errores
mc: inter-basta-una-condicion · interbloqueo · crees que con que se cumpla una sola condición, como la exclusión mutua, ya hay un interbloqueo
mc: inter-quitar-exclusion · interbloqueo · crees que el interbloqueo se evita quitando la exclusión mutua, sin ver que así aparecen condiciones de carrera
mc: inter-espera-normal · interbloqueo · confundes el interbloqueo con una espera normal por un recurso, que sí termina cuando el otro lo suelta
mc: inter-patron-igual-rompe-ciclo · interbloqueo · crees que si todos siguen la misma regla de toma, por ejemplo primero el de la izquierda, ya no puede haber espera circular
mc: inter-pausas-lo-evitan · interbloqueo · crees que añadir pausas con sleep entre las peticiones evita el interbloqueo

## Preguntas

### P16 · dificultad 1 · kc: interbloqueo · borrador · origen: ia (sonnet-5.5)
Dos threads usan dos candados, A y B (por ejemplo, dos objetos con bloques synchronized anidados). T1 toma A y luego pide B; T2 toma B y luego pide A. Ninguno suelta el que tiene mientras espera el otro. ¿Qué puede ocurrir?

- A) Solo se retrasan: uno de los dos terminará y soltará su candado, así que el programa siempre acaba · [inter-espera-normal]
- B) Pueden quedar bloqueados para siempre: T1 retiene A y espera B mientras T2 retiene B y espera A (esto no ocurre en toda ejecución) · CORRECTA
- C) Nunca queda bloqueado si cada thread hace una pausa corta con sleep entre sus dos peticiones · [inter-pausas-lo-evitan]
- D) Queda bloqueado en toda ejecución, porque la exclusión mutua de los candados basta para producir un interbloqueo · [inter-basta-una-condicion]

solución: si T1 consigue A y T2 consigue B antes de que cualquiera pida el segundo, cada uno retiene un recurso y espera el que tiene el otro, sin salida: es un interbloqueo (B). Pero si uno de los dos consigue ambos candados antes de que el otro empiece, no hay bloqueo; por eso no ocurre en toda ejecución, y no basta la exclusión mutua (D). Una pausa solo cambia la probabilidad, no la estructura (C), y esto no es una espera normal que termine sola (A).

### P17 · dificultad 2 · kc: interbloqueo · borrador · origen: ia (sonnet-5.5)
Tres threads necesitan dos candados cada uno: T1 usa A y B (pide A primero), T2 usa B y C (pide B primero) y T3 usa C y A (pide C primero). Si cada uno toma su primer candado, quedan esperando en círculo. ¿Qué cambio evita el interbloqueo?

- A) Fijar un orden global A, B, C y hacer que todos pidan primero el candado de menor orden: T3 pediría A y luego C · CORRECTA
- B) Quitar synchronized de los tres para que ningún thread tenga que esperar · [inter-quitar-exclusion]
- C) Hacer que cada thread espere 100 ms con sleep entre su primera y su segunda petición · [inter-pausas-lo-evitan]
- D) Hacer que todos sigan la misma regla de tomar primero su candado y luego el de su vecino, para que el patrón sea uniforme · [inter-patron-igual-rompe-ciclo]

solución: la espera circular se rompe si todos piden los recursos en un mismo orden global. Con el orden A, B, C: T1 pide A y B, T2 pide B y C, y T3 pide A y luego C. Así nadie puede retener un candado de mayor orden mientras espera uno de menor orden, y no se cierra el círculo. Quitar la exclusión mutua (B) deja sin protección los datos y causa condiciones de carrera. Una pausa (C) no cambia el orden de petición. Seguir la misma regla de «primero el propio» (D) es justamente el patrón que forma el círculo. Respuesta: A.

### P18 · dificultad 2 · kc: interbloqueo · borrador · origen: ia (sonnet-5.5)
En la cena de los filósofos hay cinco filósofos y cinco palillos, uno entre cada par de vecinos. Para comer, un filósofo necesita los dos palillos que tiene a los lados. Cada uno toma primero el de su izquierda, luego el de su derecha, y no suelta el primero hasta haber comido. ¿Cuál afirmación es correcta?

- A) No puede haber interbloqueo, porque en algún momento alguien termina de comer y suelta sus palillos · [inter-espera-normal]
- B) Se evita si cada filósofo hace una pausa corta entre tomar el palillo izquierdo y pedir el derecho · [inter-pausas-lo-evitan]
- C) Hay interbloqueo en toda ejecución, porque los palillos son de uso exclusivo y eso ya basta · [inter-basta-una-condicion]
- D) Puede haber interbloqueo: si los cinco toman su palillo izquierdo antes de que alguno tome el derecho, cada uno retiene uno y espera el de su vecino · CORRECTA

solución: se cumplen las cuatro condiciones: los palillos son de uso exclusivo, cada filósofo retiene uno mientras espera otro, nadie se los puede quitar y, si los cinco toman el izquierdo, se forma una cadena circular de esperas. Ya nadie puede comer ni soltar, porque soltar exige haber comido. Pero eso solo pasa en algunas intercalaciones, no en toda ejecución (C). Que alguien termine y suelte (A) no ocurre cuando todos están esperando, y una pausa (B) no cambia la estructura. Respuesta: D.

### P19 · dificultad 3 · kc: interbloqueo · borrador · origen: ia (sonnet-5.5)
Cinco filósofos se sientan en círculo con cinco palillos numerados del 0 al 4, uno entre cada par de vecinos. Cada filósofo necesita los dos palillos que tiene a sus lados y hoy toma primero el de su izquierda. ¿Cuál modificación evita el interbloqueo?

- A) No hay modificación posible mientras los palillos sean de uso exclusivo, porque esa condición ya basta para que haya interbloqueo · [inter-basta-una-condicion]
- B) Que los cinco cambien a tomar primero el palillo derecho y luego el izquierdo, igual para todos, con lo que el ciclo desaparece · [inter-patron-igual-rompe-ciclo]
- C) Que cada filósofo tome siempre primero el palillo de número menor de los dos que necesita y luego el mayor · CORRECTA
- D) Quitar la exclusión mutua para que dos filósofos puedan sujetar el mismo palillo a la vez · [inter-quitar-exclusion]

solución: para evitar el interbloqueo basta eliminar una de las cuatro condiciones. Con la regla del número menor primero se elimina la espera circular: el filósofo que tiene a sus lados los palillos 4 y 0 toma primero el 0, y así nadie puede retener un palillo de número mayor esperando uno menor, de modo que el círculo no se cierra. Cambiar a todos de izquierda a derecha (B) sigue siendo un patrón igual para todos y deja el mismo círculo. Una sola condición no basta para producir el interbloqueo, y por eso evitarlo sí es posible (A). Quitar la exclusión mutua (D) haría que dos filósofos usaran el mismo palillo a la vez, algo que no se puede permitir. Respuesta: C.

### P20 · dificultad 1 · kc: interbloqueo · borrador · origen: ia (sonnet-5.5)
Dos threads comparten un solo candado. T1 lo toma, hace Thread.sleep(500) y lo suelta; mientras tanto T2 lo pide y espera. T1 no necesita ningún otro recurso. ¿Hay interbloqueo?

- A) No: T2 espera, pero T1 no espera a nadie y acabará soltando el candado, así que no hay espera circular · CORRECTA
- B) Sí, porque T2 está esperando y toda espera por un recurso es un interbloqueo · [inter-espera-normal]
- C) Sí, porque el candado es de uso exclusivo y esa condición basta para que lo haya · [inter-basta-una-condicion]
- D) No, y solo gracias al sleep de T1: sin esa pausa habría interbloqueo · [inter-pausas-lo-evitan]

solución: un interbloqueo exige que cada thread de un círculo espere algo que retiene otro del círculo. Aquí solo T2 espera, y T1 no depende de nadie: tarde o temprano soltará el candado y T2 continuará. Es una espera normal (B se equivoca). Que el recurso sea exclusivo no basta (C), y no hay interbloqueo con o sin la pausa de T1, porque faltan la retención de un recurso mientras se espera otro y la espera circular (D). Respuesta: A.
