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

- A) Dos threads hacen cada uno 1000 veces total++ sobre el mismo campo, porque ++ es una instrucción que nadie puede interrumpir · [carr-incremento-atomico]
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
Dos threads de tipo Suma comparten un mismo objeto Total y cada uno incrementa su campo 1000 veces. El main (declarado con throws InterruptedException) los arranca y espera su fin antes de imprimir:

```
class Total { int suma = 0; }
class Suma extends Thread {
    private Total total;
    Suma(Total total) { this.total = total; }
    public void run() {
        for (int k = 0; k < 1000; k++) total.suma++;
    }
}
// main:
Total t = new Total();
Suma a = new Suma(t), b = new Suma(t);
a.start(); b.start(); a.join(); b.join();
System.out.println(t.suma);
```

¿Qué se puede afirmar del valor impreso?

- A) Imprime siempre 2000, porque join() hace que los threads accedan a suma por turnos · [carr-join-es-exclusion]
- B) Imprime siempre 2000, porque cada thread suma 1000 veces y 1000 + 1000 = 2000 · [carr-total-exacto]
- C) Puede imprimir menos de 2000, porque suma++ lee, suma y escribe en pasos separados que se pueden intercalar entre los dos threads · CORRECTA
- D) Imprime siempre 2000, porque total.suma++ es una sola operación que nadie puede interrumpir · [carr-incremento-atomico]

solución: el campo suma es un dato compartido que ambos modifican sin exclusión mutua. total.suma++ equivale a leer el valor, sumarle uno y escribirlo; si los dos threads leen el mismo valor antes de que cualquiera lo escriba, una suma se pierde. El resultado puede ser menor que 2000 (nunca mayor, y a veces justo 2000 por suerte). join() solo espera el fin de cada thread, no hace que se turnen durante la suma (A). Respuesta: C.

### P14 · dificultad 2 · kc: condicion-carrera · borrador · origen: ia (sonnet-5.5)
Dos threads de tipo Suma comparten un objeto Total y ambos hacen total.suma++ mil veces. Se quiere que el resultado sea siempre 2000 sin dejar de usar los dos threads. ¿Qué cambio lo logra?

- A) Declarar el método run() de Suma como synchronized, porque ambos threads ejecutan el mismo código · [carr-codigo-compartido]
- B) Mover el incremento a un método synchronized de Total, de modo que los dos threads se turnen sobre el mismo objeto · CORRECTA
- C) Agregar Thread.sleep(1) dentro del ciclo para que los threads no coincidan · [carr-pausa-arregla]
- D) Llamar a join() sobre los dos threads antes de imprimir, para que accedan al contador por turnos · [carr-join-es-exclusion]

solución: el problema se corrige con exclusión mutua sobre el dato compartido, y en Java se logra con un monitor: un método synchronized en la clase del objeto que ambos comparten (Total). En A, el candado de un run() synchronized es el de cada objeto Suma, que son dos objetos distintos, así que no se excluyen. Una pausa (C) solo reduce la probabilidad del choque, y join() (D) solo espera a que los threads terminen. Respuesta: B.

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
