# Ciclos: while y for

Instrucciones iterativas del nivel 3: el while con su inicio, su condición de parada y su avance, y el for-in sobre una secuencia o sobre un range. Las preguntas son de rastrear a mano cuántas veces da vueltas un ciclo y con qué valores quedan las variables.

## Habilidades
kc: while-ciclo · Rastrear un while: inicio, condición de parada y avance; contar las vueltas, decir con qué valor quedan las variables y reconocer un ciclo infinito · prerrequisitos: condicionales
kc: for-range · Recorrer con for-in una secuencia y generar valores con range(inicio, fin, paso), que no incluye el fin, y saber cuándo un for equivale a un while de conteo · prerrequisitos: while-ciclo

## Errores
mc: while-sin-avance · while-ciclo · crees que el ciclo termina solo aunque la variable de la condición nunca cambie dentro del cuerpo
mc: while-vuelta-de-mas · while-ciclo · cuentas una vuelta de más o de menos porque confundes < con <= en la condición
mc: while-como-if · while-ciclo · crees que el while ejecuta su cuerpo una sola vez, como si fuera un if
mc: while-corta-en-medio · while-ciclo · crees que la condición se revisa después de cada instrucción y el ciclo se corta a mitad del cuerpo
mc: while-valor-final · while-ciclo · crees que al salir del ciclo la variable queda con el último valor que cumplió la condición, cuando queda con el primero que no la cumple
mc: range-incluye-fin · for-range · crees que range incluye el valor final, cuando se detiene justo antes de él
mc: range-desde-uno · for-range · crees que range(n) empieza en 1, cuando empieza en 0
mc: for-in-da-indices · for-range · crees que for x in lista entrega las posiciones, cuando entrega los elementos
mc: for-cambia-variable · for-range · crees que cambiar la variable del for dentro del cuerpo cambia las vueltas que siguen
mc: range-paso-negativo · for-range · con un paso negativo crees que range cuenta hacia arriba o incluye el valor final

## Preguntas

### P13 · dificultad 1 · kc: while-ciclo · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
cajas = 0
while cajas < 4:
    cajas = cajas + 1
print(cajas)
```

- A) 3 · [while-valor-final]
- B) 5 · [while-vuelta-de-mas]
- C) 4 · CORRECTA
- D) 1 · [while-como-if]

solución: cajas arranca en 0 y el cuerpo la sube de uno en uno mientras cajas < 4. Valores al evaluar la condición: 0, 1, 2, 3 (cumple, entra) y 4 (no cumple, sale). Al salir, cajas vale 4: el primer valor que no cumple la condición, no el último que la cumplió (3). Imprime 4.

### P14 · dificultad 2 · kc: while-ciclo · borrador · origen: ia (sonnet-5.5)
¿Qué pasa al ejecutar este programa?
```
ronda = 0
while ronda < 3:
    print(ronda, end=" ")
```

- A) Nunca termina: imprime 0 una y otra vez · CORRECTA
- B) Imprime 0 1 2 · [while-sin-avance]
- C) Imprime 0 · [while-como-if]
- D) Imprime 0 1 2 3 · [while-vuelta-de-mas] crees que ronda < 3 también deja entrar al 3 y que ronda sube sola

solución: ronda vale 0 y el cuerpo solo imprime; nada dentro del while modifica ronda. La condición 0 < 3 se cumple siempre, así que el ciclo imprime 0 sin parar. A diferencia de un for, el while no avanza la variable por su cuenta.

### P15 · dificultad 2 · kc: while-ciclo · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
turno = 0
while turno < 3:
    turno = turno + 1
    print(turno, end=" ")
```

- A) 1 2 · [while-corta-en-medio]
- B) 1 2 3 4 · [while-vuelta-de-mas]
- C) 1 · [while-como-if]
- D) 1 2 3 · CORRECTA

solución: la condición se revisa solo al inicio de cada vuelta, no entre las instrucciones del cuerpo. Vuelta 1: turno 0 pasa a 1, imprime 1. Vuelta 2: pasa a 2, imprime 2. Vuelta 3: turno valía 2 (cumple), pasa a 3 e imprime 3 aunque 3 ya no cumpla turno < 3. Se revisa la condición con turno = 3, falla y sale. Imprime 1 2 3.

### P16 · dificultad 3 · kc: while-ciclo · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
saldo = 100
meses = 0
while saldo < 160:
    saldo = saldo + 20
    meses = meses + 1
print(meses, saldo)
```

- A) 3 140 · [while-valor-final]
- B) 3 160 · CORRECTA
- C) 4 180 · [while-vuelta-de-mas]
- D) 2 160 · [while-corta-en-medio]

solución: rastreo al evaluar la condición (saldo, meses): (100, 0) entra; (120, 1) entra; (140, 2) entra; (160, 3) no cumple 160 < 160 y sale. Al salir, saldo vale 160 (el primer valor que no cumple) y meses vale 3, porque la vuelta que llevó saldo a 160 también alcanzó a sumar el mes. Imprime 3 160.

### P17 · dificultad 3 · kc: while-ciclo · borrador · origen: ia (sonnet-5.5)
¿Qué pasa al ejecutar este programa?
```
paso = 0
while paso < 3:
    if paso == 5:
        paso = paso + 1
print(paso)
```

- A) Imprime 3 · [while-sin-avance]
- B) Imprime 2 · [while-valor-final] crees que el ciclo termina solo y que paso queda en 2, el último valor que cumplió la condición
- C) Imprime 0 · [while-como-if]
- D) Nunca termina y no imprime nada · CORRECTA

solución: la instrucción paso = paso + 1 existe, pero está dentro de un if que pide paso == 5. Como paso vale 0 y nunca cambia, ese if nunca se cumple y paso nunca avanza. La condición 0 < 3 siempre es verdadera: el ciclo no termina y el print final nunca se ejecuta.

### P18 · dificultad 1 · kc: for-range · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
for vagon in range(4):
    print(vagon, end=" ")
```

- A) 1 2 3 4 5 · [range-desde-uno] crees que range(4) empieza en 1 y además incluye el valor final
- B) 0 1 2 3 · CORRECTA
- C) 1 2 3 4 · [range-desde-uno]
- D) 0 1 2 3 4 · [range-incluye-fin]

solución: range(4) genera 0, 1, 2, 3: empieza en 0 y se detiene justo antes del 4. Son 4 valores y el for los recorre en orden. Imprime 0 1 2 3.

### P19 · dificultad 2 · kc: for-range · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
notas = [3, 5, 4]
for n in notas:
    print(n, end=" ")
for i in range(2):
    print(i, end=" ")
```

- A) 0 1 2 0 1 · [for-in-da-indices]
- B) 3 5 4 0 1 2 · [range-incluye-fin]
- C) 3 5 4 0 1 · CORRECTA
- D) 3 5 4 1 2 · [range-desde-uno]

solución: en el primer for, n toma los elementos de la lista: 3, 5 y 4 (no las posiciones 0, 1, 2). En el segundo, range(2) genera 0 y 1: empieza en 0 y no incluye el 2. Imprime 3 5 4 0 1.

### P20 · dificultad 2 · kc: for-range · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
for i in range(4):
    i = i + 2
    print(i, end=" ")
```

- A) 2 3 4 5 · CORRECTA
- B) 2 5 · [for-cambia-variable]
- C) 2 3 4 5 6 · [range-incluye-fin]
- D) 3 4 5 6 · [range-desde-uno]

solución: en cada vuelta el for le asigna a i el siguiente valor de range(4): 0, 1, 2, 3. Lo que i = i + 2 hace dentro del cuerpo solo vale para esa vuelta, y la siguiente vuelta empieza otra vez con el valor que entrega range. Vueltas: i = 0 pasa a 2, imprime 2; i = 1 pasa a 3; i = 2 pasa a 4; i = 3 pasa a 5. Imprime 2 3 4 5.

### P21 · dificultad 3 · kc: for-range · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
for nivel in range(6, 0, -2):
    nivel = nivel - 1
    print(nivel, end=" ")
```

- A) 5 3 1 -1 · [range-incluye-fin]
- B) 5 2 · [for-cambia-variable]
- C) 5 3 1 · CORRECTA
- D) No imprime nada · [range-paso-negativo]

solución: range(6, 0, -2) cuenta hacia abajo de 2 en 2 desde 6 y se detiene antes de llegar a 0: genera 6, 4, 2. En cada vuelta nivel se reasigna con el siguiente valor del range, y restarle 1 en el cuerpo no cambia la vuelta siguiente. Imprime 5 (de 6), 3 (de 4) y 1 (de 2).

### P22 · dificultad 3 · kc: for-range · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
v = ["a", "b", "c"]
for x in v:
    print(x, end=" ")
for i in range(len(v) - 1, -1, -1):
    print(v[i], end=" ")
```

- A) a b c · [range-paso-negativo]
- B) a b c c b a · CORRECTA
- C) 0 1 2 c b a · [for-in-da-indices]
- D) a b c c b a c · [range-incluye-fin]

solución: el primer for entrega los elementos: a, b, c. En el segundo, len(v) - 1 vale 2, así que range(2, -1, -1) baja de 1 en 1 y se detiene antes del -1: genera 2, 1, 0. Los elementos v[2], v[1] y v[0] son c, b y a. Imprime a b c c b a.
