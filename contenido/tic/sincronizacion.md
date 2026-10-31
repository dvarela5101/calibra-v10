# Sincronización en Java

Monitores, esperas y patrones de sincronización en Java. Es del Parcial 3.

## Habilidades
kc: synchronized-monitor · Proteger una sección crítica con métodos synchronized de un objeto monitor compartido por los threads · prerrequisitos: condicion-carrera
kc: espera-pasiva · Usar wait y notify o notifyAll dentro de un while que vuelve a revisar la condición · prerrequisitos: synchronized-monitor
kc: estados-y-esperas · Seguir el estado de un hilo (listo, ejecutando, bloqueado) con wait, yield, sleep y el fin del quantum, describir el cambio de contexto (interrupción, TCB) y distinguir espera activa, semiactiva y pasiva · prerrequisitos: espera-pasiva
kc: productor-consumidor · Coordinar productores y consumidores con un buffer de tamaño limitado · prerrequisitos: espera-pasiva
kc: barreras · Sincronizar un grupo de threads en un punto común con una barrera · prerrequisitos: crear-threads
kc: prioridad-y-turnos · Escribir condiciones de espera que den prioridad a un grupo o alternen turnos sin dejar a nadie esperando para siempre · prerrequisitos: espera-pasiva

## Errores
mc: monitor-wait-fuera-de-synchronized · synchronized-monitor · llamas wait o notify desde un método que no es synchronized, como si no hiciera falta tener el monitor
mc: monitor-pregunta-y-toma-separados · synchronized-monitor · crees que basta con que cada método sea synchronized aunque preguntar por el recurso y descontarlo sean dos llamadas separadas
mc: monitor-objetos-distintos · synchronized-monitor · crees que synchronized coordina a los threads aunque cada uno cree y use su propio objeto
mc: monitor-solo-un-metodo · synchronized-monitor · crees que basta con sincronizar uno de los métodos que tocan el dato compartido y que el otro puede quedar sin synchronized
mc: monitor-synchronized-espera-sola · synchronized-monitor · crees que synchronized hace que el thread espere hasta que la condición se cumpla, sin necesidad de wait
mc: monitor-synchronized-se-bloquea-solo · synchronized-monitor · crees que un thread se bloquea a sí mismo al usar dos métodos synchronized del mismo objeto, ya sea uno tras otro o uno dentro del otro
mc: pasiva-if-en-vez-de-while · espera-pasiva · usas if antes de wait y crees que el thread vuelve a revisar la condición al despertar
mc: pasiva-sin-notify · espera-pasiva · cambias la condición y no llamas notify ni notifyAll, como si los threads dormidos se enteraran solos
mc: pasiva-notify-despierta-a-todos · espera-pasiva · crees que notify despierta a todos los threads dormidos, cuando despierta a uno solo
mc: pasiva-wait-retiene-el-monitor · espera-pasiva · crees que un thread dormido en wait sigue siendo dueño del monitor y bloquea a los demás
mc: pasiva-notify-se-guarda · espera-pasiva · crees que un notify queda guardado y despierta a un thread que llegue a wait más tarde
mc: espera-condicion-disponibilidad-mal · estados-y-esperas · escribes o aceptas la condición de disponibilidad con > 1 y no notas que el último recurso libre nunca se puede tomar
mc: espera-activa-igual-que-pasiva · estados-y-esperas · crees que la espera activa gasta lo mismo de procesador que la pasiva
mc: espera-yield-duerme · estados-y-esperas · crees que yield duerme al thread hasta que lo despierten, cuando solo cede el turno
mc: espera-sleep-es-pasiva · estados-y-esperas · crees que repetir la consulta en un ciclo con sleep o yield ya es espera pasiva
mc: buffer-productor-sin-espera-lleno · productor-consumidor · crees que el productor puede depositar sin esperar aunque el buffer esté lleno, porque la lista crece sola
mc: buffer-consumidor-sin-espera-vacio · productor-consumidor · crees que el consumidor puede retirar sin esperar aunque el buffer esté vacío
mc: buffer-notify-despierta-equivocado · productor-consumidor · crees que un solo notify basta cuando esperan productores y consumidores, sin ver que puede despertar a un thread del tipo equivocado
mc: buffer-lista-sin-crear · productor-consumidor · crees que declarar el campo de la lista basta y no la creas en el constructor
mc: buffer-nextint-rango · productor-consumidor · calculas mal el rango de nextInt(n), que va de 0 a n − 1, y generas 0 o 3 muestras en vez de entre 1 y 2
mc: buffer-condicion-opuesta · productor-consumidor · confundes las condiciones y haces esperar al productor cuando el buffer está vacío o al consumidor cuando está lleno
mc: barrera-primero-sigue · barreras · crees que el primer thread que llega a la barrera puede seguir sin esperar a los demás
mc: barrera-un-solo-uso · barreras · crees que una barrera sirve una sola vez y que para otra ronda hay que crear otra o ya no bloquea
mc: barrera-partes-mal-contadas · barreras · no haces coincidir el número de partes de la barrera con el de threads que esperan en ella
mc: barrera-sleep-en-vez-de-barrera · barreras · crees que dormir un tiempo fijo asegura que los demás ya llegaron y reemplaza a la barrera
mc: barrera-monitor-notify-uno · barreras · en una barrera hecha con un monitor, despiertas con un solo notify y dejas a los demás dormidos
mc: turno-normal-pasa-con-vip · prioridad-y-turnos · dejas entrar a un cliente normal en cuanto hay cupo, sin mirar si hay VIP esperando
mc: turno-sin-contar-vip-esperando · prioridad-y-turnos · no llevas la cuenta de los VIP que esperan, así que el normal no sabe cuándo cederles el paso
mc: turno-contador-vip-no-baja · prioridad-y-turnos · sumas al contador de VIP esperando pero no lo restas cuando el VIP entra, y los normales esperan para siempre
mc: turno-sin-variable-de-turno · prioridad-y-turnos · alternas el paso sin una variable de turno y esperas que la alternancia salga sola
mc: turno-lado-entra-siempre · prioridad-y-turnos · dejas que un lado entre mientras tenga trenes esperando, y el otro lado nunca llega a pasar
mc: turno-cede-a-lado-vacio · prioridad-y-turnos · cedes el turno aunque el otro lado no tenga a nadie esperando, y el tren de este lado espera para siempre

## Preguntas

### P21 · dificultad 1 · kc: synchronized-monitor · borrador · origen: ia (sonnet-5.5)
Cuatro threads Cajero comparten una sola Cuenta. Cada uno ejecuta 1000 veces `cuenta.consignar(10)`, que hace `saldo += monto`. Al final el saldo debe ser 40000. ¿Qué cambio garantiza ese resultado?

- A) Declarar synchronized solo el método `getSaldo()`, que es el que lee el saldo · [monitor-solo-un-metodo]
- B) Llamar `wait()` al comienzo de `consignar`, que no es synchronized, para que los demás cajeros esperen · [monitor-wait-fuera-de-synchronized]
- C) Declarar synchronized el método `consignar` de la Cuenta que comparten los cuatro cajeros · CORRECTA
- D) Hacer que cada Cajero cree su propia Cuenta y consigne en ella, con `consignar` synchronized · [monitor-objetos-distintos]

solución: el problema es una condición de carrera sobre `saldo`: `saldo += monto` lee, suma y escribe, y los cuatro threads pueden intercalar esos pasos. La solución es que el método que modifica el dato sea synchronized en el objeto que todos comparten, así solo un cajero ejecuta `consignar` a la vez. A no protege la escritura. B lanza IllegalMonitorStateException, porque `wait()` exige estar dentro de un método synchronized. D crea cuatro monitores distintos, que no se coordinan entre sí (y además ya no habría una cuenta compartida). Respuesta: C.

### P22 · dificultad 2 · kc: synchronized-monitor · borrador · origen: ia (sonnet-5.5)
Dos carros ejecutan a la vez el siguiente código sobre el mismo Parqueadero, que empieza con un solo puesto libre.

```
class Parqueadero {
    private int libres = 1;
    public synchronized boolean hayCupo() { return libres > 0; }
    public synchronized void ocupar() { libres--; }
}
// cada carro ejecuta:
if (parq.hayCupo()) {
    parq.ocupar();
}
```

¿Cuál afirmación es correcta?

- A) `libres` nunca será negativo, porque tanto `hayCupo` como `ocupar` son synchronized · [monitor-pregunta-y-toma-separados]
- B) `libres` puede terminar en -1: entre la llamada a `hayCupo()` y la de `ocupar()` el otro carro puede haber consultado también y haber visto true · CORRECTA
- C) Uno de los carros espera dentro de `ocupar()` hasta que otro libere un puesto · [monitor-synchronized-espera-sola]
- D) Los dos carros se bloquean para siempre, porque el que sale de `hayCupo()` se queda sin poder entrar a `ocupar()` · [monitor-synchronized-se-bloquea-solo]

solución: cada método es atómico por separado, pero el par «preguntar y luego ocupar» no lo es. Orden posible: el carro 1 llama `hayCupo()` y recibe true; el carro 2 llama `hayCupo()` y también recibe true, porque libres sigue en 1; el carro 1 ejecuta `ocupar()` (libres = 0); el carro 2 ejecuta `ocupar()` (libres = -1). Por eso A es falsa. C es falsa: synchronized no hace esperar por una condición, solo por el monitor, y `ocupar()` no tiene ninguna condición. D es falsa: el monitor se suelta al terminar cada método, así que la siguiente llamada entra sin problema. Para arreglarlo, la pregunta y el descuento van en un solo método synchronized. Respuesta: B.

### P23 · dificultad 2 · kc: synchronized-monitor · borrador · origen: ia (sonnet-5.5)
Una Taquilla guarda `private int disponibles = 3` y varios threads Cliente compiten por las entradas. Cada cliente debe revisar si queda alguna y, si queda, tomarla, de modo que dos clientes nunca se queden con la misma. ¿Qué diseño del monitor lo logra?

- A) Un solo método synchronized `boolean reservar()` que revisa `disponibles > 0`, lo descuenta y devuelve true, o devuelve false si no quedaba nada · CORRECTA
- B) Dos métodos synchronized, `hayEntradas()` y `tomar()`, que cada cliente llama uno después del otro · [monitor-pregunta-y-toma-separados]
- C) `hayEntradas()` sin synchronized y `tomar()` synchronized, porque solo `tomar()` modifica el dato · [monitor-solo-un-metodo]
- D) Ninguno: un método synchronized que llama a otros métodos synchronized del mismo objeto se bloquea a sí mismo, así que no se puede hacer atómico · [monitor-synchronized-se-bloquea-solo]

solución: lo que debe ser atómico es el par «revisar y descontar». Eso se logra poniendo ambos pasos dentro del mismo método synchronized, que devuelve si logró reservar. B deja un hueco entre las dos llamadas: dos clientes pueden ver true antes de que alguno descuente. C deja la lectura sin proteger y tampoco cierra el hueco entre revisar y tomar. D es falso: el monitor de Java es reentrante, y además A ni siquiera llama a otro método. Respuesta: A.

### P24 · dificultad 3 · kc: synchronized-monitor · borrador · origen: ia (sonnet-5.5)
Dado este monitor, un thread consumidor llama `tomar()` sobre el Buzon compartido cuando `mensaje` todavía es null. ¿Qué ocurre en esa llamada?

```
class Buzon {
    private String mensaje = null;

    public synchronized void dejar(String m) {
        mensaje = m;
        notifyAll();
    }

    public String tomar() throws InterruptedException {
        while (mensaje == null) {
            wait();
        }
        return mensaje;
    }
}
```

- A) Queda dormido en `wait()` hasta que otro thread ejecute `dejar()` · [monitor-wait-fuera-de-synchronized]
- B) `wait()` lanza IllegalMonitorStateException, porque `tomar()` no es synchronized y el thread no es dueño del monitor · CORRECTA
- C) No pasa nada raro: basta con que `dejar()` sea synchronized, que es el único que modifica `mensaje`, y `tomar()` solo lee · [monitor-solo-un-metodo]
- D) Espera sin problema, porque el synchronized de `dejar()` hace que `tomar()` aguarde hasta que haya mensaje · [monitor-synchronized-espera-sola]

solución: `wait()` solo puede llamarse cuando el thread es dueño del monitor del objeto, es decir, dentro de un método o bloque synchronized sobre ese objeto. `tomar()` no lo es. Como `mensaje` vale null, la condición del while es verdadera y el thread llega a `wait()`, que lanza IllegalMonitorStateException. A y D suponen que el thread espera: A porque cree que `wait()` funciona sin el monitor, D porque cree que el synchronized de otro método hace esperar. C ignora que quien lee también necesita el monitor para esperar con `wait()`. La corrección es declarar `tomar()` synchronized. Respuesta: B.

### P25 · dificultad 1 · kc: synchronized-monitor · borrador · origen: ia (sonnet-5.5)
¿Qué garantiza declarar synchronized un método de una clase?

- A) Que ese método no se ejecute al mismo tiempo en dos threads, aunque cada thread use un objeto distinto de la clase · [monitor-objetos-distintos]
- B) Que el thread aguarde dentro del método hasta que se cumpla la condición que necesita · [monitor-synchronized-espera-sola]
- C) Que `wait()` y `notify()` puedan llamarse desde cualquier método de la clase, aunque no sea synchronized · [monitor-wait-fuera-de-synchronized]
- D) Que dos threads no ejecuten a la vez métodos synchronized del mismo objeto: el segundo espera a que el primero salga · CORRECTA

solución: synchronized toma el monitor del objeto sobre el que se llama el método. Dos threads que usan el mismo objeto se excluyen entre sí, y cada thread con otro objeto tiene otro monitor, por lo que A es falsa. B es falsa porque el thread espera por el monitor, no por una condición; para eso existe `wait()`. C es falsa: `wait()` y `notify()` exigen estar dentro de código synchronized sobre el mismo objeto. Respuesta: D.

### P26 · dificultad 1 · kc: espera-pasiva · borrador · origen: ia (sonnet-5.5)
Un método synchronized de un buffer debe esperar mientras no haya espacio, es decir, mientras `cupos == 0`. ¿Cuál es la forma correcta de esperar con `wait()`?

- A) `while (cupos == 0) { wait(); }` dentro del método synchronized · CORRECTA
- B) `if (cupos == 0) { wait(); }` dentro del método synchronized · [pasiva-if-en-vez-de-while]
- C) `while (cupos == 0) { wait(); }` en un método que no es synchronized · [monitor-wait-fuera-de-synchronized]
- D) No escribir ninguna espera: marcar el método como synchronized basta para que el thread aguarde hasta que haya cupos · [monitor-synchronized-espera-sola]

solución: la espera pasiva se escribe como un while que repite la pregunta, con `wait()` dentro, en un método synchronized. El while hace que el thread vuelva a revisar `cupos == 0` cada vez que despierta (puede despertar y encontrar la condición otra vez falsa). El if revisa una sola vez. Sin synchronized, `wait()` lanza IllegalMonitorStateException. Y synchronized solo da exclusión mutua, no espera por una condición. Respuesta: A.

### P27 · dificultad 2 · kc: espera-pasiva · borrador · origen: ia (sonnet-5.5)
¿Cuál afirmación sobre `notify()` es correcta?

- A) Despierta a todos los threads dormidos en `wait()` sobre ese objeto · [pasiva-notify-despierta-a-todos]
- B) Si en ese momento ningún thread espera, el aviso queda guardado y despierta al primero que llegue a `wait()` más tarde · [pasiva-notify-se-guarda]
- C) Puede llamarse desde cualquier método de la clase, sin ser dueño del monitor · [monitor-wait-fuera-de-synchronized]
- D) Despierta como máximo a un thread dormido en `wait()` sobre ese objeto; si no hay ninguno, no hace nada · CORRECTA

solución: `notify()` elige a un solo thread entre los dormidos en ese monitor (el que decide la JVM). El que despierta debe esperar a recuperar el monitor y vuelve a evaluar su condición. Para despertar a todos se usa `notifyAll()`. Si nadie espera, el aviso se pierde: no se guarda. Y como `wait()`, `notify()` exige que el thread esté dentro de código synchronized del objeto. Respuesta: D.

### P28 · dificultad 2 · kc: espera-pasiva · borrador · origen: ia (sonnet-5.5)
Este método de un buffer con varios consumidores a veces deja `cantidad` en -1.

```
public synchronized int retirar() throws InterruptedException {
    if (cantidad == 0) {
        wait();
    }
    cantidad--;
    return datos[cantidad];
}
```

¿Qué explica el fallo y cómo se corrige?

- A) Es imposible que falle: al despertar, `wait()` vuelve a evaluar la condición del if, así que no hay nada que corregir · [pasiva-if-en-vez-de-while]
- B) Un consumidor dormido en `wait()` conserva el monitor y bloquea a los demás; se corrige cambiando `wait()` por `sleep()` · [pasiva-wait-retiene-el-monitor]
- C) Un consumidor puede despertar cuando otro ya retiró el único elemento; el if no vuelve a revisar, y se corrige cambiando el if por un while · CORRECTA
- D) Falta un `notify()` al final de `retirar()` para que los demás consumidores revisen la cantidad · [pasiva-sin-notify]

solución: un thread que sale de `wait()` no sabe si la condición sigue siendo cierta: antes de recuperar el monitor, otro consumidor pudo entrar y retirar el elemento. Con if, el thread sigue de largo y hace `cantidad--` con cantidad en 0, dejándola en -1. Con while, vuelve a evaluar `cantidad == 0` y, si es verdadera, duerme otra vez. B es falso: `wait()` suelta el monitor mientras el thread duerme. D no explica el fallo: un `notify()` extra no impide que un thread despierte con la condición falsa. Respuesta: C.

### P29 · dificultad 2 · kc: espera-pasiva · borrador · origen: ia (sonnet-5.5)
Un buffer de capacidad MAX tiene este código. El buffer está vacío y un consumidor C ya está dormido en `retirar()`. Un productor P ejecuta `depositar(7)` y termina. Nadie más usa el buffer.

```
public synchronized void depositar(int x) throws InterruptedException {
    while (cantidad == MAX) { wait(); }
    datos[cantidad++] = x;
}
public synchronized int retirar() throws InterruptedException {
    while (cantidad == 0) { wait(); }
    cantidad--;
    notifyAll();
    return datos[cantidad];
}
```

¿Qué ocurre con C?

- A) Despierta por sí solo, al notar que `cantidad` subió a 1 · [pasiva-sin-notify]
- B) Sigue dormido aunque ya hay un elemento, porque nadie llamó `notify()` ni `notifyAll()` después de cambiar `cantidad` · CORRECTA
- C) Despierta, porque el `notifyAll()` de `retirar()` quedó guardado desde antes y se usa ahora · [pasiva-notify-se-guarda]
- D) El productor queda bloqueado en `depositar()` porque C, dormido, conserva el monitor · [pasiva-wait-retiene-el-monitor]

solución: P entra a `depositar(7)` sin problema, porque C soltó el monitor al ejecutar `wait()` (D es falso). P agrega el elemento y sale sin llamar `notify` ni `notifyAll`. Un thread dormido en `wait()` solo se despierta con un aviso explícito; no revisa la condición por su cuenta (A es falso). El `notifyAll()` de `retirar()` no se ejecutó nunca, y un aviso no se guarda para después (C es falso). Entonces C sigue dormido con un elemento disponible. Se corrige agregando `notifyAll()` al final de `depositar()`. Respuesta: B.

### P30 · dificultad 3 · kc: espera-pasiva · borrador · origen: ia (sonnet-5.5)
Una Sala tiene el siguiente monitor. Ahora `libres` vale 0. Un grupo G llamó `entrar(2)` y un visitante solo S llamó `entrar(1)`, y ambos están dormidos. Otro visitante ejecuta `salir(1)`.

```
class Sala {
    private int libres = 0;
    public synchronized void entrar(int n) throws InterruptedException {
        while (libres < n) { wait(); }
        libres -= n;
    }
    public synchronized void salir(int n) {
        libres += n;
        notify();
    }
}
```

¿Qué puede ocurrir a continuación?

- A) `notify()` despierta a un solo thread, escogido por la JVM: si es G, ve libres = 1, vuelve a dormir y S sigue dormido aunque ya cabe · CORRECTA
- B) `notify()` despierta a G y a S a la vez, los dos descuentan de `libres` y lo dejan negativo · [pasiva-notify-despierta-a-todos]
- C) El problema es el while de `entrar`: con if, G pasaría de largo y S podría entrar · [pasiva-if-en-vez-de-while]
- D) Falta un `notify()` dentro de `entrar`, porque `entrar` también cambia `libres` y sin él los dormidos no se enteran · [pasiva-sin-notify]

solución: tras `salir(1)`, libres vale 1. `notify()` despierta a uno solo. Si despierta a S, entra (1 ≥ 1). Si despierta a G, G recupera el monitor, evalúa `libres < 2` (verdadero), vuelve a dormir, y S queda dormido aunque cabría: nadie volverá a avisar. B es falso porque despierta a uno solo (y el while impediría un valor negativo). C es falso: sin el while, G entraría con un solo puesto libre y `libres` quedaría en -1. D es falso: `entrar` reduce los puestos y no puede hacer que alguien más avance. La corrección es usar `notifyAll()` en `salir`, para que cada dormido revise su propia condición. Respuesta: A.

### P31 · dificultad 1 · kc: estados-y-esperas · borrador · origen: ia (sonnet-5.5)
Un thread debe esperar a que termine una descarga que puede tardar varios minutos. No debe gastar procesador mientras tanto y debe enterarse en cuanto la descarga acabe. ¿Qué espera conviene?

- A) Espera activa: un while que repite la consulta, que gasta lo mismo de procesador que una espera pasiva · [espera-activa-igual-que-pasiva]
- B) Espera semiactiva con `Thread.yield()`, que duerme al thread hasta que lo despierten · [espera-yield-duerme]
- C) Un while que consulta y duerme 100 ms con `sleep()` en cada vuelta, que ya es una espera pasiva · [espera-sleep-es-pasiva]
- D) Espera pasiva: `while (!lista) wait();` en un método synchronized, y quien termina la descarga cambia `lista` y llama `notifyAll()` · CORRECTA

solución: la espera pasiva suspende al thread con `wait()`: no usa procesador y despierta cuando otro thread llama `notify` o `notifyAll`. La activa (un while que consulta sin parar) ocupa el procesador todo el tiempo, mucho más que una pasiva. `yield()` solo cede el turno: el thread sigue listo y vuelve a consultar. El ciclo con `sleep()` sigue consultando por su cuenta y puede enterarse tarde, hasta 100 ms después. Respuesta: D.

### P32 · dificultad 2 · kc: estados-y-esperas · borrador · origen: ia (sonnet-5.5)
Un thread espera un puesto con este ciclo:

```
while (!sala.hayCupo()) {
    Thread.yield();
}
```

Mientras `hayCupo()` devuelve false, ¿qué hace el thread?

- A) Se duerme y no vuelve a ejecutarse hasta que otro thread lo despierte · [espera-yield-duerme]
- B) Queda en espera pasiva: revisa la condición cada cierto tiempo y entre revisiones no usa procesador · [espera-sleep-es-pasiva]
- C) Cede el procesador a otros threads listos, pero sigue listo y vuelve a consultar cada vez que le toca; consume algo de procesador · CORRECTA
- D) Consume exactamente lo mismo de procesador que un thread dormido en `wait()` · [espera-activa-igual-que-pasiva]

solución: `yield()` es una sugerencia al planificador para ceder el procesador; el thread no se duerme ni se bloquea, solo pasa al final de los listos y volverá a ejecutarse sin que nadie lo despierte. Eso es una espera semiactiva: gasta menos que una activa pura, pero más que una pasiva, porque nunca deja de competir por el procesador. Un thread dormido en `wait()` no gasta nada hasta que lo avisan. Respuesta: C.

### P33 · dificultad 2 · kc: estados-y-esperas · borrador · origen: ia (sonnet-5.5)
Varios threads piden una impresora con una espera semiactiva sobre este monitor, que empieza con 3 impresoras libres. A veces `libres` termina en -1.

```
class Impresoras {
    private int libres = 3;
    public synchronized boolean hayLibre() { return libres > 0; }
    public synchronized void tomar() { libres--; }
}
// cada thread, sobre las mismas Impresoras:
while (!imp.hayLibre()) { Thread.yield(); }
imp.tomar();
```

¿Qué cambio corrige el problema?

- A) Cambiar `yield()` por `sleep(1000)`, para que la espera sea pasiva · [espera-sleep-es-pasiva]
- B) Reunir ambos pasos en un método synchronized `tomarSiHay()` que revisa, descuenta y devuelve true o false, y repetir `yield()` mientras devuelva false · CORRECTA
- C) Ninguno: `hayLibre()` y `tomar()` ya son synchronized, así que el par es seguro · [monitor-pregunta-y-toma-separados]
- D) Escribir `hayLibre()` como `libres > 1`, para dejar un margen y que nunca se pase de las 3 · [espera-condicion-disponibilidad-mal]

solución: el fallo ocurre porque dos threads pueden recibir true de `hayLibre()` antes de que alguno ejecute `tomar()`. En la espera semiactiva, preguntar y tomar deben ser una sola operación atómica: un método synchronized que, si hay impresora, la descuenta y devuelve true, y si no devuelve false. El ciclo queda `while (!imp.tomarSiHay()) Thread.yield();`. A cambia el tipo de espera pero no la atomicidad. C ignora el hueco entre las dos llamadas. D deja una impresora sin usar y tampoco elimina el hueco. Respuesta: B.

### P34 · dificultad 3 · kc: estados-y-esperas · borrador · origen: ia (sonnet-5.5)
Cuatro camiones ejecutan este código sobre el mismo Muelle. Ninguno sale del muelle mientras los otros van llegando.

```
class Muelle {
    private int bahias = 4;
    public synchronized boolean entrarSiHay() {
        if (bahias > 1) { bahias--; return true; }
        return false;
    }
    public synchronized void salir() { bahias++; }
}
// cada camión:
while (!muelle.entrarSiHay()) { Thread.yield(); }
```

¿Qué ocurre?

- A) Tres camiones consiguen bahía; el cuarto repite el ciclo sin poder entrar, aunque queda una bahía libre, y entretanto sigue consumiendo procesador · CORRECTA
- B) Los cuatro camiones consiguen bahía, porque las cuatro están libres al comienzo · [espera-condicion-disponibilidad-mal]
- C) Tres camiones consiguen bahía y el cuarto queda dormido hasta que alguno salga, porque `yield()` lo suspende · [espera-yield-duerme]
- D) Tres camiones consiguen bahía y el cuarto queda en espera pasiva: no gasta procesador hasta que haya una bahía libre · [espera-sleep-es-pasiva]

solución: con bahias = 4, el primer camión ve 4 > 1 y deja 3; el segundo ve 3 > 1 y deja 2; el tercero ve 2 > 1 y deja 1; el cuarto ve 1 > 1, que es falso, y recibe false. La condición debería ser `bahias > 0`: con `> 1` la última bahía nunca se puede ocupar. El cuarto camión queda en el ciclo: `yield()` solo cede el turno, no lo duerme ni lo saca de la competencia por el procesador, así que su espera es semiactiva y sigue gastando procesador, aunque menos que una activa pura. Respuesta: A.

### P35 · dificultad 1 · kc: estados-y-esperas · borrador · origen: ia (sonnet-5.5)
Un thread ejecuta `while (!listo) { }` con el cuerpo vacío, hasta que otro thread cambia `listo` (declarado `volatile`, para que el cambio se vea). ¿Qué tipo de espera es y cuánto procesador gasta?

- A) Es espera pasiva y casi no gasta procesador · [espera-sleep-es-pasiva]
- B) Es espera activa y gasta lo mismo que una espera pasiva con `wait()`, porque en ambas el thread no produce nada útil · [espera-activa-igual-que-pasiva]
- C) Es espera activa y gasta un núcleo completo mientras gira, a diferencia de una espera pasiva con `wait()` · CORRECTA
- D) Es espera semiactiva: el ciclo cede el procesador solo y el thread queda dormido hasta que alguien lo despierte · [espera-yield-duerme]

solución: el ciclo vacío consulta `listo` sin parar y sin ceder el turno, así que ocupa el procesador de forma continua: es una espera activa. La pasiva suspende al thread con `wait()` y no consume nada hasta que lo avisan. La semiactiva necesita una llamada como `yield()` dentro del ciclo, y aun así el thread no se duerme. Respuesta: C.

### P36 · dificultad 1 · kc: productor-consumidor · borrador · origen: ia (sonnet-5.5)
Un buffer de capacidad 5 es compartido por varios productores y varios consumidores, con sincronización pasiva. ¿Qué condiciones de espera debe tener?

- A) El productor espera mientras el buffer esté vacío y el consumidor espera mientras esté lleno · [buffer-condicion-opuesta]
- B) El productor espera mientras el buffer esté lleno y el consumidor espera mientras esté vacío · CORRECTA
- C) El productor nunca espera, porque la lista de Java crece sola, y el consumidor espera mientras el buffer esté vacío · [buffer-productor-sin-espera-lleno]
- D) El productor espera mientras el buffer esté lleno y el consumidor nunca espera: si no hay nada, intenta retirar igual · [buffer-consumidor-sin-espera-vacio]

solución: el productor no puede depositar cuando size() == capacidad, así que espera mientras el buffer esté lleno. El consumidor no puede retirar cuando size() == 0, así que espera mientras esté vacío. La opción A invierte las dos condiciones. En C la lista de Java sí crece, pero el buffer es de tamaño limitado y el productor debe respetar ese límite. En D, retirar de una lista vacía falla o devuelve un dato inexistente.

### P37 · dificultad 2 · kc: productor-consumidor · borrador · origen: ia (sonnet-5.5)
Se escribe este buffer y se crea con `new Buffer(3)`.

```
class Buffer {
    private List<Integer> datos;
    private final int capacidad;

    Buffer(int capacidad) {
        this.capacidad = capacidad;
    }

    synchronized void depositar(int x) throws InterruptedException {
        while (datos.size() == capacidad) wait();
        datos.add(x);
        notifyAll();
    }
}
```

Un productor llama `depositar(7)` sobre el buffer recién creado. ¿Qué ocurre?

- A) Lanza NullPointerException en `datos.size()`, porque el constructor nunca crea la lista · CORRECTA
- B) Agrega el 7 sin problema: la lista existe y está vacía desde que se declara el campo · [buffer-lista-sin-crear]
- C) Queda en wait, porque la lista está vacía y debe esperar a que un consumidor ponga algo antes de depositar · [buffer-condicion-opuesta]
- D) Agrega el 7, y los siguientes depositar tampoco esperarán aunque ya haya 3 elementos, porque la lista crece sola · [buffer-productor-sin-espera-lleno]

solución: el campo `datos` es una referencia que vale null hasta que alguien le asigne `new ArrayList<>()`. El constructor solo guarda `capacidad`, así que `datos.size()` falla con NullPointerException en la primera llamada, antes de llegar al while. La corrección es crear la lista en el constructor. La opción B supone que declarar el campo crea el objeto. La C invierte la condición de espera del productor. La D ignora que el while sí debe frenar al productor con 3 elementos.

### P38 · dificultad 2 · kc: productor-consumidor · borrador · origen: ia (sonnet-5.5)
En una cocina, cada vez que le toca el turno, un mesero debe generar al azar entre 2 y 4 pedidos y dejarlos de a uno en la cola de la cocina; si la cola está llena, debe esperar con wait hasta que haya sitio. `azar` es un `java.util.Random` y `cola.depositar` ya espera con wait cuando no hay espacio. ¿Qué fragmento lo hace?

- A) `int n = azar.nextInt(3); for (int i = 0; i < n; i++) cola.depositar(new Pedido());` · [buffer-nextint-rango] crees que nextInt(3) da de 2 a 4, cuando da de 0 a 2
- B) `int n = azar.nextInt(3) + 2; for (int i = 0; i < n; i++) cola.depositar(new Pedido());` · CORRECTA
- C) `int n = azar.nextInt(4) + 1; for (int i = 0; i < n; i++) cola.depositar(new Pedido());` · [buffer-nextint-rango] crees que nextInt(4) + 1 da de 2 a 4, pero también puede dar 1
- D) `int n = azar.nextInt(3) + 2; for (int i = 0; i < n; i++) { if (cola.hayEspacio()) cola.depositar(new Pedido()); }` · [buffer-productor-sin-espera-lleno]

solución: `nextInt(k)` devuelve enteros de 0 a k − 1. Con `nextInt(3)` salen 0, 1 o 2; sumando 2 salen 2, 3 o 4, que es el rango pedido. A produce de 0 a 2 pedidos, así que puede no generar ninguno ni llegar a 4. C produce de 1 a 4: alcanza los cuatro pero también deja pasar un solo pedido. En D el rango es correcto, pero cuando la cola está llena el pedido se descarta en vez de esperar con wait. Respuesta: B.

### P39 · dificultad 3 · kc: productor-consumidor · borrador · origen: ia (sonnet-5.5)
Un buffer de capacidad 1 tiene depositar y retirar sincronizados. Cada uno espera con wait dentro de un while sobre su condición y termina con un único `notify()`. Hay dos productores (P1, P2) y dos consumidores (C1, C2). El programa se detiene: P2 y C2 están dormidos en wait, el buffer está vacío y los demás threads ya terminaron. ¿Cuál es una explicación posible?

- A) No debería poder detenerse así: notify despierta siempre a un thread del tipo contrario, que es el que puede avanzar, así que la causa está en otra parte · [buffer-notify-despierta-equivocado]
- B) Un consumidor retiró con el buffer vacío sin esperar y descuadró el conteo de elementos, por eso el buffer parece vacío · [buffer-consumidor-sin-espera-vacio]
- C) Un productor depositó con el buffer lleno sin esperar y descuadró el conteo de elementos, por eso nadie avisó a P2 · [buffer-productor-sin-espera-lleno]
- D) El notify de C1 despertó a C2, otro consumidor, que encontró el buffer vacío y volvió a esperar, mientras P2 seguía dormido aunque ya había espacio; con notifyAll habría despertado también P2 · CORRECTA

solución: una traza posible. Buffer vacío; C1 y C2 esperan. P1 deposita y su notify despierta a C1. Antes de que C1 retome el monitor, P2 llama depositar, ve el buffer lleno y espera. C1 retira y su notify elige a uno de los dos dormidos (C2 y P2): si elige a C2, este ve el buffer vacío y vuelve a esperar. P2 queda dormido con espacio libre y nadie volverá a avisarle. Con notify no se controla a quién se despierta cuando esperan threads de dos tipos; notifyAll despierta a todos y cada uno revisa su propia condición. Las opciones B y C contradicen que cada método espera en un while sobre su condición, y A afirma lo contrario de lo que hace notify.

### P40 · dificultad 3 · kc: productor-consumidor · borrador · origen: ia (sonnet-5.5)
Se revisan cuatro versiones del software de una línea de ensamble con 4 soldadores, 3 pintores y un contenedor de capacidad 6. En cada turno un soldador produce entre 2 y 3 piezas (con un `Random azar`) y las deja de a una en el contenedor; los pintores las retiran. En las cuatro versiones los métodos del contenedor son synchronized y esperan con wait dentro de un while. Solo una versión es correcta. ¿Cuál?

- A) El constructor guarda la capacidad y crea la lista con `new ArrayList<>()`; depositar espera mientras size() == capacidad, retirar espera mientras size() == 0, ambos terminan con un único notify, porque así se despierta solo al thread que necesita el cambio · [buffer-notify-despierta-equivocado]
- B) El constructor guarda la capacidad y la lista queda apenas declarada como campo; las esperas son las correctas, ambos métodos terminan con notifyAll y los soldadores usan `azar.nextInt(2) + 2` · [buffer-lista-sin-crear]
- C) El constructor guarda la capacidad y crea la lista; depositar espera mientras size() == capacidad, retirar espera mientras size() == 0, ambos terminan con notifyAll y los soldadores usan `azar.nextInt(2) + 2` · CORRECTA
- D) El constructor guarda la capacidad y crea la lista; las esperas son las correctas y ambos terminan con notifyAll, pero los soldadores usan `azar.nextInt(3)` · [buffer-nextint-rango] crees que nextInt(3) da 2 o 3, cuando da 0, 1 o 2

solución: cada versión falla en un solo punto. A termina con notify aunque pueden estar dormidos soldadores y pintores a la vez: puede despertar a uno del tipo equivocado, que revisa su condición y vuelve a dormir, mientras el que sí podía avanzar sigue dormido. B nunca crea la lista y lanza NullPointerException en la primera llamada. D genera 0, 1 o 2 piezas, porque `nextInt(3)` va de 0 a 2, y el enunciado pide 2 o 3. C crea la lista, espera mientras el contenedor está lleno o vacío según el lado, avisa con notifyAll y genera 2 o 3 piezas con `nextInt(2) + 2`. Respuesta: C.

### P41 · dificultad 1 · kc: barreras · borrador · origen: ia (sonnet-5.5)
Cuatro threads comparten una barrera creada con `new CyclicBarrier(4)` y cada uno llama `barrera.await()`. ¿Qué afirmación es correcta?

- A) El primer thread en llegar sigue de inmediato y los demás lo alcanzan después · [barrera-primero-sigue]
- B) La barrera sirve una sola vez: para una segunda ronda hay que crear otra · [barrera-un-solo-uso]
- C) Cada thread espera un tiempo fijo y luego continúa, suponiendo que para entonces ya llegaron los demás · [barrera-sleep-en-vez-de-barrera]
- D) Cada thread queda bloqueado en await hasta que los cuatro hayan llegado; entonces se liberan juntos y la misma barrera se puede usar en rondas siguientes · CORRECTA

solución: await bloquea a quien lo llama hasta que el número de partes (4) haya llegado. Ninguno pasa antes, ni siquiera el primero (A). No hay tiempos de espera fijos (C). Una CyclicBarrier, como dice su nombre, se reinicia sola al abrirse y se puede reutilizar (B es falsa).

### P42 · dificultad 2 · kc: barreras · borrador · origen: ia (sonnet-5.5)
Se crea una `CyclicBarrier(3)`. Cuatro threads T1, T2, T3 y T4 llaman `await()` una sola vez, en ese orden, y no hay más threads en el programa. ¿Qué ocurre?

- A) T1 y T2 quedan bloqueados hasta que llega T3, y entonces continúan los tres; T4 queda bloqueado para siempre porque nunca llegan dos más · CORRECTA
- B) Los cuatro continúan, porque la barrera se abre cuando han llegado todos los threads que la usan · [barrera-partes-mal-contadas]
- C) T1 continúa en cuanto llega por ser el primero, T2 y T3 se esperan entre ellos y T4 pasa solo · [barrera-primero-sigue]
- D) Los tres primeros continúan y T4 también, sin esperar, porque la barrera ya se usó y no vuelve a bloquear · [barrera-un-solo-uso]

solución: la barrera se abre cuando llegan 3 partes. T1 y T2 esperan; al llegar T3 se completa el grupo y los tres continúan. La barrera se reinicia y T4 empieza una ronda nueva: necesita otros dos threads que no existen, así que espera para siempre. B supone que cuenta a todos los threads del programa y no a las partes con que se creó. C deja pasar al primero sin esperar. D cree que, una vez abierta, ya no bloquea.

### P43 · dificultad 2 · kc: barreras · borrador · origen: ia (sonnet-5.5)
Tres threads ejecutan este ciclo sobre la misma barrera, creada una sola vez con `new CyclicBarrier(3)`.

```
for (int ronda = 0; ronda < 4; ronda++) {
    calcularFase(ronda);
    barrera.await();
}
```

¿Qué ocurre?

- A) Solo la primera ronda sincroniza; desde la segunda, await ya no bloquea · [barrera-un-solo-uso]
- B) En cada ronda, el primer thread que termina la fase pasa a la siguiente mientras los otros acaban la actual, y solo se igualan al final · [barrera-primero-sigue]
- C) En cada una de las 4 rondas, ningún thread empieza la fase siguiente hasta que los 3 han terminado la actual, y la misma barrera se reutiliza sola · CORRECTA
- D) Para que sea seguro hay que dormir al final de cada ronda más tiempo del que tarda el thread más lento · [barrera-sleep-en-vez-de-barrera]

solución: una CyclicBarrier se reinicia automáticamente cada vez que se abre, así que el mismo objeto sirve para las 4 rondas. En cada ronda los tres threads quedan bloqueados en await hasta que llega el último; recién entonces empieza la ronda siguiente. Ni el primero en terminar se adelanta (B), ni await deja de bloquear después de la primera ronda (A), ni hace falta adivinar tiempos de espera (D).

### P44 · dificultad 3 · kc: barreras · borrador · origen: ia (sonnet-5.5)
Una barrera hecha con un monitor:

```
class Barrera {
    private final int total;
    private int llegaron = 0;

    Barrera(int total) { this.total = total; }

    public synchronized void esperar() throws InterruptedException {
        llegaron++;
        if (llegaron < total) {
            wait();
        } else {
            llegaron = 0;
            notify();
        }
    }
}
```

Se crea `new Barrera(4)`. Cuatro threads llaman `esperar()` una vez cada uno, uno detrás de otro; el cuarto en llegar es el último. ¿Qué ocurre?

- A) Los cuatro continúan: al llegar el cuarto se despiertan los tres que esperaban · [barrera-monitor-notify-uno]
- B) El cuarto reinicia el contador, despierta a uno solo de los tres que esperaban y continúa; los otros dos quedan bloqueados en wait para siempre · CORRECTA
- C) El cuarto queda esperando para siempre, porque la barrera se creó con 4 y debería haberse creado con 3 · [barrera-partes-mal-contadas]
- D) Los tres que esperan se despiertan solos tras unos segundos, porque un wait() siempre vuelve pasado un tiempo · [barrera-sleep-en-vez-de-barrera]

solución: los tres primeros incrementan el contador (1, 2, 3) y entran en wait porque 3 < 4. El cuarto lo lleva a 4, entra por el else, lo reinicia a 0 y llama notify(), que despierta a un solo thread entre los tres dormidos. Los otros dos siguen en wait sin que nadie vuelva a avisarles. Hay que usar notifyAll(). El valor 4 es el correcto para cuatro threads (C), y un wait() sin argumentos no termina solo (D).

### P45 · dificultad 1 · kc: barreras · borrador · origen: ia (sonnet-5.5)
Una barrera hecha con un monitor cuenta los threads que llegan con una variable `llegaron`. ¿Qué debe hacer el último thread en llegar?

- A) Poner `llegaron` en 0 y despertar a todos los que esperan con notifyAll, para que la barrera quede lista para la siguiente ronda · CORRECTA
- B) Despertar a uno con notify, confiando en que los demás se despertarán en cadena · [barrera-monitor-notify-uno]
- C) Dejar `llegaron` como está y despertar a todos, porque la barrera ya cumplió su trabajo y no se vuelve a usar · [barrera-un-solo-uso]
- D) Dormir unos segundos antes de seguir, para dar tiempo a que los demás salgan del wait · [barrera-sleep-en-vez-de-barrera]

solución: el último en llegar completa el grupo y debe liberar a todos los demás, lo que exige notifyAll. Un notify despierta a uno solo (B) y los otros no despiertan en cadena. Reiniciar el contador a 0 permite que la misma barrera sirva en la ronda siguiente; si no se reinicia (C), la segunda ronda se rompe. Dormir no es necesario (D): los threads dormidos salen del wait en cuanto reciben el aviso y recuperan el monitor.

### P46 · dificultad 1 · kc: prioridad-y-turnos · borrador · origen: ia (sonnet-5.5)
Un puente de un solo carril une las orillas norte y sur, y solo cabe un carro a la vez. Se quiere que, cuando las dos orillas tienen carros esperando, se turnen para cruzar. ¿Qué necesita el monitor del puente?

- A) Solo una bandera de puente ocupado: al terminar de cruzar, cada carro hace notifyAll y el reparto entre orillas se da solo · [turno-sin-variable-de-turno]
- B) Una variable de turno que cambia siempre cuando un carro termina de cruzar; un carro cruza solo si es el turno de su orilla, incluso si la otra orilla está vacía · [turno-cede-a-lado-vacio]
- C) Dejar cruzar a una orilla mientras le queden carros esperando y pasar a la otra solo cuando se quede sin ninguno · [turno-lado-entra-siempre]
- D) Una variable de turno que cambia cuando un carro termina de cruzar; un carro espera si el puente está ocupado, o si es el turno de la otra orilla y esa orilla tiene carros esperando · CORRECTA

solución: para alternar hace falta recordar a quién le toca, es decir, una variable de turno; una bandera sola (A) da exclusión mutua pero ningún reparto. Además el turno solo debe frenar a un carro si la otra orilla de verdad tiene carros esperando; si no, el carro esperaría sin que nadie fuera a cruzar (B). En C, una orilla con tráfico continuo deja sin paso a la otra. D reúne las tres cosas: turno, cambio al terminar el cruce y turno ignorado si la otra orilla está vacía. Respuesta: D.

### P47 · dificultad 2 · kc: prioridad-y-turnos · borrador · origen: ia (sonnet-5.5)
Una sala de urgencias tiene 8 camas. Cuando queda una libre se atiende primero a los pacientes prioritarios, y un paciente regular solo ocupa cama si no hay ningún prioritario esperando. ¿Qué diseño del monitor lo cumple?

- A) Un solo contador de camas ocupadas; todos esperan mientras no haya cama libre, y al liberarse una entra el primero que alcance a despertar · [turno-normal-pasa-con-vip]
- B) Dos contadores, camas ocupadas y prioritarios esperando: el prioritario suma 1 al llegar, espera mientras las 8 camas estén ocupadas y resta 1 cuando consigue cama; el regular espera mientras las camas estén ocupadas o el contador de prioritarios sea mayor que 0; al liberar una cama se llama notifyAll · CORRECTA
- C) Un contador de prioritarios que ya están en cama; el regular espera mientras las camas estén ocupadas o haya algún prioritario en cama · [turno-sin-contar-vip-esperando]
- D) Un contador de prioritarios esperando que se suma al llegar y nunca se resta; el regular espera mientras las camas estén ocupadas o ese contador sea mayor que 0 · [turno-contador-vip-no-baja]

solución: para ceder el paso, el regular necesita saber cuántos prioritarios están esperando: el contador sube al llegar el prioritario y baja cuando este consigue cama. En A nadie mira a los prioritarios, así que un regular puede quedarse con la cama antes que ellos. En C se cuentan los prioritarios que ya están atendidos y no los que esperan, de modo que el regular pasa aunque haya fila de prioritarios. En D el contador nunca baja: tras el primer prioritario, los regulares esperan para siempre. Respuesta: B.

### P48 · dificultad 2 · kc: prioridad-y-turnos · borrador · origen: ia (sonnet-5.5)
Una terminal de buses tiene 6 andenes y da prioridad a los buses expreso. Su monitor tiene este método de llegada; el método `salir()` solo hace `ocupados--` y notifyAll.

```
public synchronized void llegar(boolean expreso) throws InterruptedException {
    if (expreso) expresosEnCola++;
    while (ocupados == 6 || (!expreso && expresosEnCola > 0)) {
        wait();
    }
    ocupados++;
}
```

Desde que entra el primer bus expreso, ningún bus regular vuelve a ocupar andén, aunque la terminal esté casi vacía y no haya expresos en cola. ¿Qué cambio lo corrige sin quitar la prioridad?

- A) Quitar la parte `!expreso && expresosEnCola > 0` de la condición del while · [turno-normal-pasa-con-vip]
- B) Cambiar la condición del regular para que mire cuántos expresos están ya en un andén · [turno-sin-contar-vip-esperando]
- C) Poner `expresosEnCola = 0` dentro de `salir()`, para que los regulares pasen cuando algún bus se va · [turno-normal-pasa-con-vip]
- D) Restar con `if (expreso) expresosEnCola--;` justo después del while y antes de `ocupados++` · CORRECTA

solución: `expresosEnCola` sube cuando llega un expreso, pero nunca baja; una vez que vale 1 o más, la condición del regular siempre se cumple y este espera. Cuando el expreso sale del while ya consiguió andén y deja de estar en cola, así que debe restar 1 antes de ocuparlo. Quitar la condición (A) o poner el contador en 0 cada vez que un bus sale (C) deja pasar regulares mientras hay expresos esperando. Contar los expresos que ya ocupan andén (B) tampoco detecta a los que esperan. Respuesta: D.

### P49 · dificultad 3 · kc: prioridad-y-turnos · borrador · origen: ia (sonnet-5.5)
Una vía compartida usa esta regla. Un tren entra solo si la vía está libre y se cumple una de dos cosas: es el turno de su lado, o el otro lado no tiene trenes esperando. Al salir un tren, el turno pasa al otro lado si ese lado tiene trenes esperando; si no, el turno se queda en el mismo lado. Al salir también se hace notifyAll. Un tren acaba de salir y la vía quedó libre; el turno es del lado A, esperan 3 trenes en A y 1 en B, no llegan trenes nuevos y cada tren sale apenas entra. ¿En qué orden entran?

- A) A, A, A, B · [turno-lado-entra-siempre]
- B) A, B, A, A · CORRECTA
- C) A, B y luego los dos trenes restantes de A esperan para siempre, porque el turno volvió a B y B ya no tiene trenes · [turno-cede-a-lado-vacio]
- D) No se puede saber: con notifyAll todos compiten y entra el que el planificador elija · [turno-sin-variable-de-turno]

solución: entra el primer tren de A (turno de A). Al salir, B tiene 1 esperando, así que el turno pasa a B. Entra el tren de B. Al salir, A tiene 2 esperando, el turno vuelve a A y entra otro tren de A. Al salir, B ya no tiene trenes esperando, así que el turno se queda en A y entra el último tren de A. Orden: A, B, A, A. La opción A deja pasar a los tres trenes de A antes que al de B, aunque B tuviera el turno. En C se pierde el caso en que el otro lado está vacío y el turno no frena a nadie. En D la regla sí fija quién puede entrar en cada momento: notifyAll solo despierta a todos, y la condición decide.

### P50 · dificultad 1 · kc: prioridad-y-turnos · borrador · origen: ia (sonnet-5.5)
El monitor de una pista de aterrizaje da prioridad a los aviones en emergencia sobre los comerciales y tiene un contador `emergenciasEsperando`. ¿Para qué sirve?

- A) Para saber cuántos aviones en emergencia están esperando turno: sube cuando uno llega y baja cuando consigue la pista, y así un avión comercial sabe si debe cederles el paso · CORRECTA
- B) Para contar todas las emergencias atendidas desde que arrancó el programa, sin bajarlo nunca · [turno-contador-vip-no-baja]
- C) Para contar cuántos aviones en emergencia están usando la pista en este momento y que los comerciales sepan si hay alguno ahí · [turno-sin-contar-vip-esperando]
- D) Para nada necesario: como la pista solo admite un avión a la vez, las emergencias ya pasan primero · [turno-normal-pasa-con-vip]

solución: la prioridad depende de quién espera, no de quién ya usa la pista. El contador debe subir cuando una emergencia llega a esperar y bajar cuando entra; un avión comercial espera mientras valga más que 0. Si cuenta las emergencias que ya están en la pista (C), no detecta la fila. Si nunca baja (B), los comerciales quedan bloqueados para siempre. Que la pista admita un solo avión (D) no distingue tipos de avión y no da ninguna prioridad. Respuesta: A.
