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
Cuatro brazos robóticos están montados en círculo alrededor de una mesa de ensamble. Entre cada par de brazos vecinos hay una herramienta, así que hay cuatro herramientas en total. Para armar una pieza, un brazo necesita las dos herramientas que tiene a sus lados. Cada brazo toma primero la herramienta que queda en el sentido de las agujas del reloj, luego la otra, y no suelta la primera hasta terminar su pieza. ¿Cuál afirmación es correcta?

- A) No puede haber interbloqueo, porque en algún momento un brazo termina su pieza y devuelve sus herramientas · [inter-espera-normal]
- B) Se evita si cada brazo hace una pausa corta entre tomar la primera herramienta y pedir la segunda · [inter-pausas-lo-evitan]
- C) Hay interbloqueo en toda ejecución, porque las herramientas se usan de a un brazo y esa condición ya basta · [inter-basta-una-condicion]
- D) Puede haber interbloqueo: si los cuatro toman su primera herramienta antes de que alguno pida la segunda, cada uno retiene una y espera la del brazo vecino · CORRECTA

solución: se cumplen las cuatro condiciones: cada herramienta la usa un solo brazo a la vez, cada brazo retiene una mientras pide otra, nadie se la puede arrebatar a otro y, si los cuatro toman la primera, queda un círculo de esperas. Ningún brazo puede avanzar ni devolver nada, porque devolver exige haber terminado la pieza. Pero eso ocurre solo en algunas intercalaciones, no en toda ejecución (C). Que alguien termine y devuelva (A) no sucede cuando todos están esperando, y una pausa (B) no cambia la estructura. Respuesta: D.

### P19 · dificultad 3 · kc: interbloqueo · borrador · origen: ia (sonnet-5.5)
Seis técnicos trabajan en una mesa circular de un taller. Entre cada par de técnicos vecinos hay una llave de torque, y las seis llaves están numeradas del 1 al 6. Para apretar una pieza, cada técnico necesita las dos llaves que tiene a sus lados y por costumbre toma primero la que queda a su izquierda. ¿Cuál modificación, que se pueda aplicar en el taller, evita el interbloqueo?

- A) No hay modificación posible mientras las llaves sean de uso exclusivo, porque esa condición ya basta para que haya interbloqueo · [inter-basta-una-condicion]
- B) Que los seis cambien a tomar primero la llave de la derecha y luego la de la izquierda, igual para todos, con lo que el ciclo desaparece · [inter-patron-igual-rompe-ciclo]
- C) Que cada técnico tome siempre primero la llave de número menor de las dos que necesita y luego la de número mayor · CORRECTA
- D) Quitar la exclusión mutua para que dos técnicos puedan sostener la misma llave a la vez · [inter-quitar-exclusion]

solución: para evitar el interbloqueo basta eliminar una de las cuatro condiciones. Con la regla de la llave menor primero se elimina la espera circular: el técnico que tiene a sus lados las llaves 6 y 1 toma primero la 1, y así nadie puede retener una llave de número mayor esperando una de número menor, de modo que el círculo no se cierra. Cambiar a todos de izquierda a derecha (B) sigue siendo un patrón igual para todos y deja el mismo círculo. Una sola condición no basta para producir el interbloqueo, y por eso evitarlo sí es posible (A). Quitar la exclusión mutua (D) haría que dos técnicos usaran la misma llave a la vez, algo que no se puede permitir. Respuesta: C.

### P20 · dificultad 1 · kc: interbloqueo · borrador · origen: ia (sonnet-5.5)
Dos threads comparten un solo candado. T1 lo toma, hace Thread.sleep(500) y lo suelta; mientras tanto T2 lo pide y espera. T1 no necesita ningún otro recurso. ¿Hay interbloqueo?

- A) No: T2 espera, pero T1 no espera a nadie y acabará soltando el candado, así que no hay espera circular · CORRECTA
- B) Sí, porque T2 está esperando y toda espera por un recurso es un interbloqueo · [inter-espera-normal]
- C) Sí, porque el candado es de uso exclusivo y esa condición basta para que lo haya · [inter-basta-una-condicion]
- D) No, y solo gracias al sleep de T1: sin esa pausa habría interbloqueo · [inter-pausas-lo-evitan]

solución: un interbloqueo exige que cada thread de un círculo espere algo que retiene otro del círculo. Aquí solo T2 espera, y T1 no depende de nadie: tarde o temprano soltará el candado y T2 continuará. Es una espera normal (B se equivoca). Que el recurso sea exclusivo no basta (C), y no hay interbloqueo con o sin la pausa de T1, porque faltan la retención de un recurso mientras se espera otro y la espera circular (D). Respuesta: A.
