# Patrones de recorrido

Recorrido total (sumar, contar, buscar el mayor o el menor de toda la secuencia) y recorrido parcial (parar cuando se encuentra lo buscado, con o sin centinela). En el curso el recorrido parcial se hace con while, no con for ni break.

## Habilidades
kc: recorrido-total · Recorrer toda una lista o cadena con contador, acumulador o mayor y menor, con while e índice, con for-range o con for-in · prerrequisitos: for-range, listas-operaciones
kc: busqueda-centinela · Detener un ciclo al encontrar lo buscado, con un centinela o con una condición compuesta, sin salirse del rango, y devolver la posición o -1 · prerrequisitos: while-ciclo, recorrido-total, condicionales

## Errores
mc: acumulador-dentro · recorrido-total · inicias el acumulador dentro del ciclo, así que se reinicia en cada vuelta
mc: mayor-desde-cero · recorrido-total · inicias el mayor en 0, y con valores todos negativos el resultado sale mal
mc: elemento-como-indice · recorrido-total · usas el elemento como si fuera una posición, lista[x], cuando el for-in ya entrega el elemento
mc: indice-hasta-len · recorrido-total · recorres con el índice hasta len(lista) incluido, que se sale del rango
mc: promedio-entre-todos · recorrido-total · divides entre la cantidad total de elementos, cuando el promedio es solo de los que cumplen la condición
mc: return-sigue-recorriendo · recorrido-total · crees que un return dentro del ciclo deja que el recorrido siga, cuando termina la función en esa vuelta
mc: centinela-no-detiene · busqueda-centinela · crees que el ciclo para en el mismo instante en que el centinela cambia, cuando la condición solo se revisa al volver al while
mc: rango-despues-de-comparar · busqueda-centinela · pones la comparación con el elemento antes del control del índice, y al no encontrarlo el programa se sale del rango
mc: condicion-de-parada · busqueda-centinela · escribes en el while la condición de parada, cuando va la de continuación, que es su negación
mc: posicion-corrida · busqueda-centinela · devuelves el índice después de un avance de más, una posición corrida
mc: no-encontrado-ultima · busqueda-centinela · crees que si no encuentra el valor devuelve la última posición o None, cuando el patrón devuelve -1
mc: sin-parar-ultima · busqueda-centinela · crees que un recorrido que no se detiene se queda con la primera aparición, cuando se queda con la última

## Preguntas

### P38 · dificultad 1 · kc: recorrido-total · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?

```
def total_litros(tanques):
    total = 0
    for t in tanques:
        total = total + t
    return total

print(total_litros([12, 5, 8, 20]))
```

- A) 20 · [acumulador-dentro]
- B) Da IndexError · [elemento-como-indice]
- C) 45 · CORRECTA
- D) 12 · [return-sigue-recorriendo]

solución: total arranca en 0 fuera del ciclo y t toma cada elemento: 0+12=12, 12+5=17, 17+8=25, 25+20=45. El return está después del for, así que se ejecuta una sola vez al final y devuelve 45.

### P39 · dificultad 2 · kc: recorrido-total · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?

```
def promedio_altas(lecturas):
    suma = 0
    cuantas = 0
    i = 0
    while i < len(lecturas):
        if lecturas[i] > 10:
            suma = suma + lecturas[i]
            cuantas = cuantas + 1
        i = i + 1
    return suma / cuantas

print(promedio_altas([4, 12, 7, 18, 15, 3]))
```

- A) 15.0 · CORRECTA
- B) 7.5 · [promedio-entre-todos]
- C) Da IndexError · [indice-hasta-len]
- D) 0.0 · [acumulador-dentro]

solución: solo cuentan las lecturas mayores que 10: 12, 18 y 15. La suma es 45 y cuantas vale 3, así que 45 / 3 = 15.0 (la división con / siempre da float). Si se dividiera entre len(lecturas) = 6 saldría 7.5. Si suma se reiniciara en 0 dentro del ciclo, la última lectura (3) la dejaría en 0 y saldría 0 / 3 = 0.0.

### P40 · dificultad 2 · kc: recorrido-total · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?

```
def temperatura_maxima(temps):
    mayor = temps[0]
    for i in range(1, len(temps)):
        if temps[i] > mayor:
            mayor = temps[i]
    return mayor

print(temperatura_maxima([-8, -12, -3, -5]))
```

- A) -8 · [return-sigue-recorriendo]
- B) Da IndexError · [indice-hasta-len]
- C) 0 · [mayor-desde-cero]
- D) -3 · CORRECTA

solución: mayor arranca en temps[0] = -8. Con i=1: -12 no supera a -8. Con i=2: -3 > -8, mayor pasa a -3. Con i=3: -5 no supera a -3. range(1, 4) llega hasta el índice 3, que existe, y el resultado es -3. Si mayor arrancara en 0, ningún valor negativo lo superaría y saldría 0.

### P41 · dificultad 3 · kc: recorrido-total · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?

```
def promedio_bajo_cero(temps):
    suma = 0
    cuantas = 0
    for t in temps:
        if t < 0:
            suma = suma + t
            cuantas = cuantas + 1
    return suma / cuantas

print(promedio_bajo_cero([-4, 3, -10, 8, -1]))
```

- A) -3.0 · [promedio-entre-todos]
- B) -5.0 · CORRECTA
- C) Da IndexError · [elemento-como-indice]
- D) -0.3333333333333333 · [acumulador-dentro]

solución: t toma cada elemento de la lista. Los negativos son -4, -10 y -1: suma = -15 y cuantas = 3, así que -15 / 3 = -5.0. Dividir entre los 5 elementos daría -3.0. Si se usara temps[t] como si t fuera una posición, temps[-4] vale 3, temps[3] vale 8 y temps[-10] no existe: IndexError. Si suma se reiniciara dentro del ciclo, al final solo quedaría el último valor negativo (-1) y saldría -1 / 3.

### P42 · dificultad 3 · kc: recorrido-total · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?

```
def posicion_del_mayor(valores):
    mayor = valores[0]
    pos = 0
    i = 1
    while i < len(valores):
        if valores[i] > mayor:
            mayor = valores[i]
            pos = i
        i = i + 1
    return pos

print(posicion_del_mayor([-9, -4, -7, -2, -6]))
```

- A) 1 · [return-sigue-recorriendo]
- B) Da IndexError · [indice-hasta-len]
- C) 3 · CORRECTA
- D) 0 · [mayor-desde-cero]

solución: mayor = -9 y pos = 0. i=1: -4 > -9, mayor = -4 y pos = 1. i=2: -7 no supera a -4. i=3: -2 > -4, mayor = -2 y pos = 3. i=4: -6 no supera a -2. El ciclo termina cuando i vale 5 y se devuelve pos = 3. Un return dentro del if habría terminado la función en pos = 1; y si mayor arrancara en 0 no se actualizaría nunca y saldría 0.

### P43 · dificultad 1 · kc: busqueda-centinela · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?

```
def buscar_casillero(casilleros, llave):
    i = 0
    while i < len(casilleros) and casilleros[i] != llave:
        i = i + 1
    if i < len(casilleros):
        return i
    return -1

print(buscar_casillero([7, 4, 9, 2, 9, 5], 9))
```

- A) 4 · [sin-parar-ultima]
- B) 2 · CORRECTA
- C) 3 · [posicion-corrida]
- D) 0 · [condicion-de-parada]

solución: el ciclo avanza mientras no se acabe la lista y el casillero actual sea distinto de 9. i=0 (7) y i=1 (4) avanzan; en i=2 hay un 9, la condición casilleros[i] != llave es falsa y el ciclo se detiene. Como 2 < 6, devuelve 2: la primera aparición, no la de la posición 4. El 9 está en la posición 2, no en la 3.

### P44 · dificultad 2 · kc: busqueda-centinela · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?

```
def hasta_la_helada(temps, limite):
    i = 0
    hallada = False
    while i < len(temps) and not hallada:
        if temps[i] < limite:
            hallada = True
        i = i + 1
    return i

print(hasta_la_helada([6, 2, 8, 2], 3))
```

- A) 1 · [centinela-no-detiene]
- B) 0 · [condicion-de-parada]
- C) 4 · [sin-parar-ultima] crees que la bandera no frena el ciclo y que el recorrido sigue hasta la última aparición
- D) 2 · CORRECTA

solución: i=0: 6 no es menor que 3, i pasa a 1. i=1: 2 < 3, hallada se vuelve True, pero el ciclo no se detiene en ese instante: sigue la vuelta y ejecuta i = i + 1, así que i vale 2. Al volver al while, not hallada es falso y el ciclo termina. Devuelve 2.

### P45 · dificultad 2 · kc: busqueda-centinela · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?

```
def posicion_de(codigos, buscado):
    i = 0
    while codigos[i] != buscado and i < len(codigos):
        i = i + 1
    if i < len(codigos):
        return i
    return -1

print(posicion_de([15, 8, 23, 42], 7))
```

- A) Da IndexError · CORRECTA
- B) -1 · [rango-despues-de-comparar]
- C) 3 · [no-encontrado-ultima]
- D) 0 · [condicion-de-parada]

solución: el 7 no está en la lista, así que i sigue avanzando. Cuando i vale 4, el while evalúa primero codigos[4] != buscado, y la posición 4 no existe: IndexError antes de llegar a revisar i < len(codigos). Para que devolviera -1 el control del rango tendría que ir primero: i < len(codigos) and codigos[i] != buscado.

### P46 · dificultad 3 · kc: busqueda-centinela · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?

```
def posicion(lista, x):
    i = 0
    hallada = False
    while i < len(lista) and not hallada:
        if lista[i] == x:
            hallada = True
        i = i + 1
    if hallada:
        return i - 1
    return -1

print(posicion([3, 8, 5, 1, 6], 5), posicion([3, 8, 5, 1, 6], 9))
```

- A) 3 -1 · [posicion-corrida]
- B) 2 4 · [no-encontrado-ultima]
- C) 2 -1 · CORRECTA
- D) 1 -1 · [centinela-no-detiene]

solución: primera llamada, x = 5: i=0 (3) y i=1 (8) no coinciden; en i=2 hallada pasa a True, y esa misma vuelta hace i = 3. Se devuelve i - 1 = 2. Segunda llamada, x = 9: nunca se halla, el ciclo termina con i = 5, hallada sigue en False y se devuelve -1. Se imprime 2 -1.

### P47 · dificultad 3 · kc: busqueda-centinela · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?

```
def pos_numeral(clave):
    i = 0
    while clave[i] != "#" and i < len(clave):
        i = i + 1
    if i < len(clave):
        return i
    return -1

print(pos_numeral("Ab#cD"), pos_numeral("Abcde"))
```

- A) 3 -1 · [posicion-corrida]
- B) 2 -1 · [rango-despues-de-comparar]
- C) 2 4 · [no-encontrado-ultima]
- D) Da IndexError · CORRECTA

solución: primero se evalúan los dos argumentos del print. pos_numeral("Ab#cD") funciona y daría 2, porque encuentra el "#" antes de salirse. En pos_numeral("Abcde") no hay "#": cuando i vale 5 el while evalúa clave[5] antes de revisar i < len(clave) y da IndexError. Como el error ocurre antes de que print imprima, no se muestra ni el 2: el programa solo termina con el error.
