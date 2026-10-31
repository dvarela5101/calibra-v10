# Procesos y threads

Conceptos de concurrencia y threads en Java. Es del Parcial 3. Supone saber programar en Java (el banco de Introducción a la Programación es en Python).

## Habilidades
kc: conceptos-concurrencia · Distinguir programa, proceso y thread (qué es privado de cada thread y qué comparten), núcleos físicos y lógicos (SMT), y concurrencia de paralelismo
kc: crear-threads · Crear y arrancar threads en Java (extends Thread, run frente a start, start una sola vez) y predecir qué corre de forma concurrente · prerrequisitos: conceptos-concurrencia
kc: condicion-carrera · Reconocer una condición de carrera sobre un dato compartido que alguien modifica, y saber que se corrige con exclusión mutua · prerrequisitos: crear-threads

## Errores
mc: conc-programa-proceso-invertido · conceptos-concurrencia · crees que un programa es un proceso en ejecución, cuando el proceso es lo que resulta de ejecutar un programa
mc: conc-un-procesador-sin-concurrencia · conceptos-concurrencia · crees que con un solo procesador no puede haber concurrencia y las tareas solo corren una tras otra hasta terminar
mc: conc-concurrencia-exige-paralelismo · conceptos-concurrencia · confundes concurrencia con paralelismo y crees que varias tareas solo avanzan si hay varios procesadores trabajando en el mismo instante
mc: conc-intercalar-es-paralelismo · conceptos-concurrencia · llamas paralelismo a repartir un solo procesador entre varias tareas por turnos
mc: conc-thread-memoria-propia · conceptos-concurrencia · crees que cada thread de un proceso tiene su propia memoria, como si fuera un proceso aparte
mc: conc-quantum-es-tiempo-en-memoria · conceptos-concurrencia · crees que el quantum mide cuánto puede un proceso permanecer residente en memoria, cuando mide cuánto puede usar seguido el procesador
mc: thr-run-directo · crear-threads · crees que el thread arranca llamando a run() directamente, cuando así el código corre dentro del thread que lo llama
mc: thr-start-varias-veces · crear-threads · crees que start() se puede llamar varias veces sobre el mismo objeto para repetir la ejecución
mc: thr-new-activa · crear-threads · crees que new Thread(...) ya crea y activa el thread, cuando solo construye el objeto
mc: thr-orden-fijo · crear-threads · crees que los threads se ejecutan en un orden fijo, por ejemplo el de creación o el de arranque
mc: thr-main-espera · crear-threads · crees que después de start() el thread que lo llamó se queda esperando a que el nuevo termine
mc: thr-sobrescribe-start · crear-threads · crees que el trabajo del thread se define sobrescribiendo start(), cuando se define en run()
mc: carr-sincronizar-todo · condicion-carrera · crees que todo programa que comparte datos necesita sincronización, aunque nadie los modifique
mc: carr-codigo-compartido · condicion-carrera · crees que basta con que los threads compartan el código o la clase, cuando lo que importa es el objeto compartido
mc: carr-total-exacto · condicion-carrera · ves una suma compartida sin protección y esperas siempre el total exacto
mc: carr-incremento-atomico · condicion-carrera · crees que x++ es una sola operación que ningún otro thread puede interrumpir
mc: carr-pausa-arregla · condicion-carrera · crees que una pausa con sleep entre accesos elimina la condición de carrera
mc: carr-join-es-exclusion · condicion-carrera · crees que join() hace que los threads accedan por turnos al dato compartido, cuando solo espera a que un thread termine
mc: conc-pila-compartida · conceptos-concurrencia · crees que los threads de un proceso comparten la pila o el contador de programa, cuando cada uno necesita los suyos para estar en un punto distinto del programa
mc: conc-smt-logicos-mal · conceptos-concurrencia · cuentas mal los núcleos lógicos de un procesador con SMT, ya sea ignorando el SMT o contando más de dos por núcleo físico
mc: conc-nucleo-tipo-invertido · conceptos-concurrencia · asignas el tipo de núcleo al revés: núcleos de eficiencia para el cálculo intensivo o núcleos de rendimiento para el trabajo que casi solo espera entrada y salida

## Preguntas

### P1 · dificultad 1 · kc: conceptos-concurrencia · borrador · origen: ia (sonnet-5.5)
¿Cuál de las siguientes afirmaciones es correcta?

- A) Un programa es un proceso en ejecución, y el archivo guardado en el disco es el proceso · [conc-programa-proceso-invertido]
- B) Un proceso es lo que se obtiene al poner a ejecutar un programa, que es el código guardado · CORRECTA
- C) El quantum mide cuánto puede un proceso permanecer residente en la memoria antes de ser expulsado · [conc-quantum-es-tiempo-en-memoria]
- D) Un thread es lo mismo que un proceso: cada thread tiene su propia memoria, independiente de los demás · [conc-thread-memoria-propia]

solución: el programa es el código guardado (por ejemplo, el ejecutable en el disco). Al ponerlo a correr, el sistema operativo crea un proceso: un programa en ejecución. La opción A invierte los términos. El quantum no se refiere a la memoria sino al máximo de tiempo seguido que un proceso usa el procesador antes de cederlo (opción C). Un thread es un flujo de control dentro de un proceso y comparte la memoria de ese proceso con sus hermanos (opción D). La correcta es B.

### P2 · dificultad 1 · kc: conceptos-concurrencia · borrador · origen: ia (sonnet-5.5)
Un computador tiene un solo procesador con un solo núcleo. ¿Cuál de las siguientes afirmaciones es correcta?

- A) Solo puede haber concurrencia si se agrega un segundo procesador · [conc-concurrencia-exige-paralelismo]
- B) Solo puede ejecutar procesos por lotes: cada uno corre completo antes de que empiece el siguiente · [conc-un-procesador-sin-concurrencia]
- C) Los procesos que se turnan el procesador están en paralelo, porque todos avanzan · [conc-intercalar-es-paralelismo]
- D) Puede haber concurrencia: el procesador se reparte entre varios procesos, aunque en cada instante ejecute solo uno · CORRECTA

solución: concurrencia es que varias tareas progresen intercaladas en el tiempo; no exige que se ejecuten en el mismo instante. Con un solo núcleo el sistema operativo alterna los procesos por turnos y todos avanzan, así que hay concurrencia (D). Que se ejecuten realmente a la vez es paralelismo y necesita varios procesadores o núcleos (A y C confunden los dos conceptos). El procesamiento por lotes es solo una forma de usar el procesador, no la única posible (B).

### P3 · dificultad 2 · kc: conceptos-concurrencia · borrador · origen: ia (sonnet-5.5)
Un servidor tiene un solo procesador de un solo núcleo. Da un turno corto a cada petición y pasa a la siguiente, de modo que todas las peticiones van avanzando. ¿Cómo se llama correctamente la capacidad de hacer progresar varias tareas de esta manera?

- A) Concurrencia: las tareas se intercalan en el tiempo, aunque en cada instante solo una use el procesador · CORRECTA
- B) Paralelismo, porque varias tareas avanzan al mismo tiempo · [conc-intercalar-es-paralelismo]
- C) Procesamiento por lotes, porque el procesador atiende una sola tarea hasta terminarla antes de pasar a otra · [conc-un-procesador-sin-concurrencia]
- D) Multiprocesamiento, que exige al menos dos procesadores trabajando en el mismo instante · [conc-concurrencia-exige-paralelismo]

solución: las peticiones avanzan por turnos sobre un único procesador. Eso es concurrencia: progreso intercalado. El paralelismo (B) significa ejecución simultánea en varios procesadores o núcleos, que aquí no existen. Por lotes (C) sería terminar cada tarea antes de empezar otra, lo contrario de lo descrito. El multiprocesamiento (D) requiere hardware con varios procesadores. Respuesta: A.

### P4 · dificultad 2 · kc: conceptos-concurrencia · borrador · origen: ia (sonnet-5.5)
Un navegador es un proceso que tiene tres threads, uno por pestaña. ¿Cuál afirmación es correcta?

- A) Cada thread tiene su propia copia de la memoria del proceso, así que lo que uno escribe no lo ve el otro · [conc-thread-memoria-propia]
- B) Mientras el navegador corre, eso es un programa; el archivo instalado en el disco es el proceso · [conc-programa-proceso-invertido]
- C) Los tres threads comparten la memoria del proceso, pero cada uno tiene su propio flujo de control (su pila y su contador de programa) · CORRECTA
- D) El quantum de cada thread indica cuánto tiempo puede permanecer residente en la memoria antes de ser reemplazado · [conc-quantum-es-tiempo-en-memoria]

solución: el navegador instalado es el programa; al ejecutarlo se crea el proceso (B invierte los términos). Los threads de un mismo proceso son flujos de control distintos que comparten el espacio de memoria del proceso, y por eso pueden ver y modificar los mismos datos (A es falsa). Lo que cada thread tiene propio es su pila y su punto de ejecución. El quantum es el tiempo máximo seguido de procesador, no de permanencia en memoria (D). Respuesta: C.

### P5 · dificultad 3 · kc: conceptos-concurrencia · borrador · origen: ia (sonnet-5.5)
Un computador con un solo núcleo ejecuta dos threads, A y B, del mismo proceso. El planificador reparte el procesador por turnos con un quantum de 10 ms. A necesita 25 ms de procesador y B necesita 15 ms. Ambos llegan en el instante 0, A está primero en la cola y cambiar de thread no cuesta tiempo. ¿Cuál afirmación es correcta?

- A) A termina en el instante 25 ms y B en el 40 ms, porque con un solo núcleo cada uno corre completo antes de dar paso al otro · [conc-un-procesador-sin-concurrencia]
- B) B termina en el instante 35 ms y A en el 40 ms: es concurrencia, porque nunca corren a la vez pero ambos avanzan intercalados · CORRECTA
- C) B termina en el instante 15 ms y A en el 25 ms, porque concurrencia significa que los dos corren simultáneamente · [conc-concurrencia-exige-paralelismo]
- D) B termina en el instante 35 ms y A en el 40 ms, y eso es paralelismo porque ambos avanzan por turnos · [conc-intercalar-es-paralelismo]

solución: línea de tiempo con quantum de 10 ms. De 0 a 10 corre A (le quedan 15 ms). De 10 a 20 corre B (le quedan 5 ms). De 20 a 30 corre A (le quedan 5 ms). De 30 a 35 corre B, que termina en 35. De 35 a 40 corre A, que termina en 40. En ningún instante corren los dos a la vez: hay concurrencia y no paralelismo (B es correcta y D se equivoca en el nombre). Los tiempos de A y de C solo se darían si cada uno corriera completo o si hubiera dos núcleos.

### P6 · dificultad 1 · kc: crear-threads · borrador · origen: ia (sonnet-5.5)
Se quiere que un trabajo corra en un thread propio, usando una clase que extiende Thread. ¿Qué pasos son los correctos?

- A) Sobrescribir start() con el trabajo y luego llamar a run() sobre el objeto · [thr-sobrescribe-start]
- B) Sobrescribir run() con el trabajo y crear el objeto con new: el constructor ya deja el thread ejecutándose · [thr-new-activa]
- C) Sobrescribir run() con el trabajo, crear el objeto con new y llamar a start() · CORRECTA
- D) Sobrescribir run() con el trabajo y llamar a start() cada vez que se quiera repetir el trabajo con el mismo objeto · [thr-start-varias-veces]

solución: el trabajo del thread se escribe en run(). new solo construye el objeto; el thread empieza cuando se llama a start(), que pide al sistema crear el flujo de control y luego invoca run() en él. start() se puede llamar una sola vez por objeto; repetir el trabajo exige un objeto nuevo. Respuesta: C.

### P7 · dificultad 2 · kc: crear-threads · borrador · origen: ia (sonnet-5.5)
Dada esta clase, el método main crea un objeto y llama a run() directamente:

```
class Aviso extends Thread {
    public void run() {
        System.out.println("A");
    }
}
public class Prueba {
    public static void main(String[] args) {
        Aviso t = new Aviso();
        t.run();
        System.out.println("B");
    }
}
```

¿Qué imprime el programa?

- A) Imprime A y luego B, siempre en ese orden, porque run() se ejecuta dentro del thread main · CORRECTA
- B) Puede imprimir B antes que A, porque run() ejecuta el código en un thread nuevo · [thr-run-directo]
- C) Imprime A dos veces, una cuando new crea y activa el thread y otra al llamar run() · [thr-new-activa]
- D) No compila, porque falta sobrescribir start(), que es donde se define lo que hace el thread · [thr-sobrescribe-start]

solución: llamar a run() es una llamada normal a un método: no crea ningún thread, así que el código se ejecuta en el thread que lo llama (main), de forma secuencial. Se imprime A y después B. new tampoco activa nada (C), y el trabajo se define en run(), no en start() (D). Respuesta: A.

### P8 · dificultad 2 · kc: crear-threads · borrador · origen: ia (sonnet-5.5)
¿Qué ocurre al ejecutar este programa?

```
class Aviso extends Thread {
    public void run() {
        System.out.println("A");
    }
}
public class Prueba {
    public static void main(String[] args) {
        Aviso t = new Aviso();
        t.start();
        t.start();
    }
}
```

- A) Imprime A dos veces, una por cada llamada a start() · [thr-start-varias-veces]
- B) No compila, porque la clase no sobrescribe start() · [thr-sobrescribe-start]
- C) No imprime nada, porque el thread solo arranca cuando alguien llama a run() · [thr-run-directo]
- D) La segunda llamada a start() lanza IllegalThreadStateException, y A se imprime una sola vez · CORRECTA

solución: la primera llamada a start() arranca el thread, que ejecuta run() e imprime A una vez. Un objeto Thread solo se puede arrancar una vez: tanto si el thread sigue corriendo como si ya terminó, la segunda llamada a start() lanza IllegalThreadStateException. Para volver a ejecutar el trabajo hay que crear otro objeto. El programa compila (no hace falta sobrescribir start()) y el thread sí arranca con start(), sin llamar a run() a mano. Respuesta: D.

### P9 · dificultad 1 · kc: crear-threads · borrador · origen: ia (sonnet-5.5)
La clase Aviso extiende Thread y su método run() imprime "A". El método main hace esto:

```
Aviso t = new Aviso();
t.start();
System.out.println("B");
```

¿Qué se puede afirmar de la salida?

- A) Imprime A y luego B, siempre, porque main espera a que el thread termine su run() antes de seguir · [thr-main-espera]
- B) Se imprimen A y B, pero el orden entre las dos líneas no está determinado · CORRECTA
- C) Imprime B y luego A, siempre, porque el thread solo corre cuando main ya terminó · [thr-orden-fijo]
- D) Imprime solo B, porque start() deja el thread listo y la A sale cuando alguien llame a run() · [thr-run-directo]

solución: start() lanza un thread nuevo y devuelve de inmediato; main sigue con su println sin esperar. Los dos flujos corren de forma concurrente y el planificador decide cuál escribe primero, así que se imprimen A y B en cualquier orden. main no espera al thread (A), no hay un orden fijo (C) y no hace falta llamar a run() (D). Respuesta: B.

### P10 · dificultad 3 · kc: crear-threads · borrador · origen: ia (sonnet-5.5)
Este programa arranca dos threads y luego main imprime "fin":

```
class Escribe extends Thread {
    private String letra;
    Escribe(String letra) { this.letra = letra; }
    public void run() {
        for (int k = 0; k < 3; k++) System.out.println(letra);
    }
}
public class Prueba {
    public static void main(String[] args) {
        new Escribe("a").start();
        new Escribe("b").start();
        System.out.println("fin");
    }
}
```

¿Cuál afirmación es segura?

- A) Se imprimen tres líneas con a, tres con b y una con fin, pero el orden entre esas siete líneas no está determinado · CORRECTA
- B) Imprime siempre a, a, a, b, b, b y fin, porque los threads corren en el orden en que se arrancaron · [thr-orden-fijo]
- C) Imprime las seis letras y fin de último, siempre, porque main espera a que acaben los dos threads · [thr-main-espera]
- D) Imprime solo fin; las letras salen cuando alguien llame a run() sobre cada objeto · [thr-run-directo]

solución: cada start() lanza un thread que imprime tres veces su letra, y main imprime fin. En total son siete líneas, seguras en cantidad, pero los tres flujos (a, b y main) se intercalan como decida el planificador, por lo que ni el orden de arranque ni la posición de fin están garantizados. Sin join(), main no espera a nadie (C), no hay orden fijo (B) y start() es lo que pone a correr cada run() (D). Respuesta: A.

### P11 · dificultad 1 · kc: condicion-carrera · borrador · origen: ia (sonnet-5.5)
¿En cuál de estas situaciones NO hay condición de carrera?

- A) Tres threads hacen cada uno 700 veces conteo++ sobre el mismo campo, porque ++ es una instrucción que nadie puede interrumpir · [carr-incremento-atomico]
- B) Dos threads suman al mismo saldo, pero cada uno espera Thread.sleep(1) entre suma y suma, y así nunca coinciden · [carr-pausa-arregla]
- C) Cuatro threads suman su parte en un acumulador compartido sin protección, y el total siempre sale exacto · [carr-total-exacto]
- D) Cuatro threads suman su parte en una variable local de su propio run() y cada uno imprime la suya · CORRECTA

solución: hay condición de carrera cuando varios threads acceden a un mismo dato y al menos uno lo modifica sin exclusión mutua. En A, ++ son tres pasos (leer, sumar, escribir) que se pueden intercalar. En B, una pausa no garantiza que los accesos no se solapen. En C, sin protección el total puede perder sumas. En D cada thread usa una variable local propia y no hay dato compartido. Respuesta: D.

### P12 · dificultad 1 · kc: condicion-carrera · borrador · origen: ia (sonnet-5.5)
Tres threads leen el mismo arreglo de temperaturas para calcular, cada uno, un promedio distinto que guarda en una variable local. Ningún thread escribe en el arreglo. ¿Qué es correcto?

- A) No hay condición de carrera: nadie modifica el arreglo compartido, así que no hace falta exclusión mutua · CORRECTA
- B) Hay que proteger el arreglo con exclusión mutua, porque todo dato compartido por varios threads necesita sincronización · [carr-sincronizar-todo]
- C) Hay condición de carrera porque los tres threads ejecutan el mismo código de la misma clase · [carr-codigo-compartido]
- D) Hay carrera, pero se evita haciendo que cada thread espere un tiempo distinto con sleep antes de leer · [carr-pausa-arregla]

solución: la carrera aparece cuando alguien modifica un dato compartido. Si todos solo leen y los resultados van a variables locales, los accesos concurrentes no se estorban y no se necesita sincronización. Compartir un dato (B) o compartir el código (C) no basta, y una pausa (D) no resuelve una carrera que además no existe. Respuesta: A.

### P13 · dificultad 2 · kc: condicion-carrera · borrador · origen: ia (sonnet-5.5)
Tres threads de tipo Empacador comparten una misma Bodega. Cada uno repite 500 veces la orden de sumar 2 unidades al campo de la bodega. El main (declarado con throws InterruptedException) los arranca y espera su fin antes de imprimir:

```
class Bodega { int unidades = 0; }
class Empacador extends Thread {
    private Bodega bodega;
    Empacador(Bodega bodega) { this.bodega = bodega; }
    public void run() {
        for (int k = 0; k < 500; k++) bodega.unidades += 2;
    }
}
// main:
Bodega b = new Bodega();
Empacador[] e = { new Empacador(b), new Empacador(b), new Empacador(b) };
for (Empacador x : e) x.start();
for (Empacador x : e) x.join();
System.out.println(b.unidades);
```

¿Qué se puede afirmar del valor impreso?

- A) Imprime siempre 3000, porque join() obliga a que los threads modifiquen unidades uno después de otro · [carr-join-es-exclusion]
- B) Imprime siempre 3000, porque 3 threads por 500 repeticiones por 2 unidades da exactamente 3000 · [carr-total-exacto]
- C) Puede imprimir menos de 3000, porque unidades += 2 lee, suma y escribe en pasos separados que se pueden intercalar entre los threads · CORRECTA
- D) Imprime siempre 3000, porque bodega.unidades += 2 es una sola operación indivisible · [carr-incremento-atomico]

solución: unidades es un dato compartido que los tres threads modifican sin exclusión mutua. La instrucción += 2 equivale a leer el valor, sumarle 2 y escribirlo; si dos threads leen el mismo valor antes de que alguno lo escriba, una suma se pierde. La cuenta ideal es 3 · 500 · 2 = 3000, pero el valor impreso puede quedar por debajo (nunca por encima, y a veces justo en 3000 por suerte). join() solo espera a que cada thread termine, no los hace turnarse mientras suman (A). Respuesta: C.

### P14 · dificultad 2 · kc: condicion-carrera · borrador · origen: ia (sonnet-5.5)
Cuatro threads de tipo Llenador comparten un objeto Tanque. Cada uno ejecuta 300 veces tanque.litros += 5 sobre el campo litros, y main espera con join() a que los cuatro terminen antes de imprimir; se espera que haya 6000. Hoy el resultado a veces sale menor. Se quiere que sea siempre 6000 sin dejar de usar los cuatro threads. ¿Qué cambio lo logra?

- A) Declarar el método run() de Llenador como synchronized, porque los cuatro threads ejecutan el mismo código · [carr-codigo-compartido]
- B) Mover la suma a un método synchronized de Tanque, de modo que los cuatro threads se turnen sobre el mismo objeto · CORRECTA
- C) Agregar Thread.sleep(1) dentro del ciclo para que los threads casi nunca coincidan · [carr-pausa-arregla]
- D) Agregar un segundo join() sobre cada thread antes de imprimir, para que modifiquen litros por turnos · [carr-join-es-exclusion]

solución: el problema se corrige con exclusión mutua sobre el dato compartido, y en Java se logra con un monitor: un método synchronized en la clase del objeto que todos comparten (Tanque). Así cada += 5 se completa antes de que otro thread lo empiece, y el total es 4 · 300 · 5 = 6000. En A, el candado de un run() synchronized es el de cada objeto Llenador, que son cuatro objetos distintos, así que no se excluyen. Una pausa (C) solo reduce la probabilidad del choque, y join() (D) solo espera a que los threads terminen, algo que main ya hace. Respuesta: B.

### P15 · dificultad 3 · kc: condicion-carrera · borrador · origen: ia (sonnet-5.5)
Cada Cajero crea su propia Cuenta. Se arrancan dos cajeros:

```
class Cuenta {
    private int saldo = 0;
    public synchronized void consignar() { saldo++; }
    public int getSaldo() { return saldo; }
}
class Cajero extends Thread {
    private Cuenta cuenta = new Cuenta();
    public void run() {
        for (int k = 0; k < 1000; k++) cuenta.consignar();
        System.out.println(cuenta.getSaldo());
    }
}
// main: new Cajero().start(); new Cajero().start();
```

¿Qué imprime el programa?

- A) Puede imprimir menos de 1000, porque los dos cajeros ejecutan el mismo código y se estorban · [carr-codigo-compartido]
- B) Puede imprimir menos de 1000, porque cualquier dato usado desde varios threads necesita una protección adicional a synchronized · [carr-sincronizar-todo]
- C) Imprime 1000 y 1000, siempre: cada cajero usa su propia Cuenta, que ningún otro thread toca, y no hay objeto compartido · CORRECTA
- D) Puede imprimir menos de 1000, porque saldo++ no es una sola operación y las consignaciones de los dos cajeros se pisan · [carr-incremento-atomico]

solución: cada Cajero construye su propia Cuenta, así que los dos threads trabajan sobre objetos distintos: no hay dato compartido y, por tanto, no hay condición de carrera, aunque ejecuten el mismo código. Cada thread suma sus 1000 consignaciones sobre su cuenta y la imprime: 1000 y 1000 en cualquier orden. Compartir el código (A) o ser un programa con threads (B) no crea la carrera, y saldo++ solo es un problema cuando dos threads tocan el mismo saldo (D); además, consignar ya es synchronized. Respuesta: C.

### P101 · dificultad 1 · kc: conceptos-concurrencia · borrador · origen: ia (sonnet-5.5)
Un proceso tiene tres threads. ¿Cuál afirmación sobre lo que es propio de cada thread y lo que comparten es correcta?

- A) Los tres threads comparten la pila, así que cada uno ve las variables locales de los otros; lo único propio de cada uno son los registros · [conc-pila-compartida]
- B) Cada thread tiene su propia copia de los datos globales del proceso, y solo el código es común a los tres · [conc-thread-memoria-propia] crees que cada thread tiene su propia copia de los datos, cuando los datos del proceso son comunes a todos sus threads
- C) Cada thread tiene sus propios registros, su contador de programa y su pila; los tres comparten el código, los datos y los archivos abiertos · CORRECTA
- D) Nada se comparte: cada thread tiene su propia memoria completa y sus propios archivos, como si fuera un proceso aparte · [conc-thread-memoria-propia]

solución: un thread es un flujo de control dentro de un proceso. Para ser un flujo propio necesita sus registros, su contador de programa (EIP, la próxima instrucción que va a ejecutar) y su pila (las llamadas y las variables locales). Lo demás pertenece al proceso y es común: el código, los datos y los archivos abiertos. Por eso un thread puede ver lo que otro escribió en un dato global, pero no ve las variables locales de otro. A es falsa: si compartieran la pila no podrían estar en funciones distintas a la vez. B y D les dan memoria propia, como a un proceso aparte, y eso no ocurre en un thread. Respuesta: C.

### P102 · dificultad 2 · kc: conceptos-concurrencia · borrador · origen: ia (sonnet-5.5)
Un procesador tiene 6 núcleos físicos, todos con SMT de dos vías: 2 son núcleos de rendimiento y 4 son núcleos de eficiencia. Se va a ejecutar un programa que descarga y guarda archivos, y que pasa casi todo el tiempo esperando la red y el disco, con muy poco cálculo. ¿Cuántos núcleos lógicos ve el sistema operativo y en qué tipo de núcleo conviene más ejecutarlo?

- A) 12 núcleos lógicos; en los núcleos de eficiencia, porque el programa casi no usa la unidad aritmética y uno de rendimiento gastaría más energía sin aprovecharse · CORRECTA
- B) 6 núcleos lógicos, uno por núcleo físico; en los núcleos de eficiencia · [conc-smt-logicos-mal] crees que el SMT no agrega núcleos lógicos y cuentas solo los físicos
- C) 12 núcleos lógicos; en los núcleos de rendimiento, porque son más rápidos y el programa terminará antes · [conc-nucleo-tipo-invertido] crees que a la espera de red y disco le sirve un núcleo más rápido, cuando se pasa esperando y gasta más energía sin ganar tiempo
- D) 24 núcleos lógicos, cuatro por núcleo físico; en los núcleos de eficiencia · [conc-smt-logicos-mal] crees que el SMT de dos vías da cuatro núcleos lógicos por núcleo físico

solución: con SMT de dos vías, cada núcleo físico se presenta al sistema operativo como dos núcleos lógicos: 6 × 2 = 12 (B cuenta solo los físicos y D cuenta cuatro por núcleo). Para un programa que casi solo espera entrada y salida, la velocidad del reloj importa poco, porque el procesador está ocioso la mayor parte del tiempo; un núcleo de eficiencia basta y gasta menos energía. Un núcleo de rendimiento tendría un consumo mayor con muy poca utilización (C). Respuesta: A.

### P103 · dificultad 3 · kc: conceptos-concurrencia · borrador · origen: ia (sonnet-5.5)
Un proceso de simulación lanza 4 threads de cálculo intensivo. Los cuatro leen un mismo arreglo grande, que nadie modifica, y cada uno acumula su suma parcial en una variable local de su método run(). El procesador tiene 4 núcleos de rendimiento, con SMT de dos vías, y 8 núcleos de eficiencia, sin SMT. ¿Cuál descripción es correcta?

- A) Los threads comparten la pila, así que los cuatro suman en la misma variable local; el sistema operativo ve 16 núcleos lógicos y el cálculo conviene a los núcleos de rendimiento · [conc-pila-compartida]
- B) Hay un solo arreglo y cada thread suma en su propia variable local; el sistema operativo ve 12 núcleos lógicos, uno por núcleo físico, y el cálculo conviene a los núcleos de rendimiento · [conc-smt-logicos-mal]
- C) Hay un solo arreglo y cada thread suma en su propia variable local; el sistema operativo ve 16 núcleos lógicos y el cálculo conviene a los núcleos de eficiencia, porque gastan menos energía · [conc-nucleo-tipo-invertido]
- D) Hay un solo arreglo, común a los cuatro threads, y cada uno suma en su propia variable local, guardada en su propia pila; el sistema operativo ve 16 núcleos lógicos (4 × 2 + 8) y el cálculo conviene a los núcleos de rendimiento · CORRECTA

solución: el arreglo vive en los datos del proceso, que los threads comparten; como solo se lee, no hay condición de carrera. La variable local de run() vive en la pila del thread, y cada thread tiene la suya, así que las sumas parciales no se mezclan (A es falsa). Núcleos lógicos: los 4 de rendimiento con SMT de dos vías aportan 4 × 2 = 8 y los 8 de eficiencia, sin SMT, aportan 8: en total 16. Contar solo los físicos da 12 (B). Un cálculo intensivo aprovecha el reloj más alto de los núcleos de rendimiento; en los de eficiencia ahorraría energía pero tardaría más (C). Respuesta: D.
