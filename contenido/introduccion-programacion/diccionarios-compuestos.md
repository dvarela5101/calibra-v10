# Recorrido de diccionarios y estructuras compuestas

Recorrer un diccionario por llaves o por valores, contar con un diccionario (histograma) y manejar estructuras compuestas: diccionario de diccionarios y lista de diccionarios.

## Habilidades
kc: recorrer-diccionarios · Recorrer un diccionario por sus llaves, con keys() o con values(), y armar un conteo con él · prerrequisitos: recorrido-total, cadenas-diccionarios
kc: estructuras-compuestas · Acceder y recorrer un diccionario de diccionarios y una lista de diccionarios para filtrar, contar o hallar el mayor · prerrequisitos: recorrer-diccionarios, listas-operaciones

## Errores
mc: for-dict-valores · recorrer-diccionarios · crees que for k in d recorre los valores, cuando recorre las llaves
mc: for-dict-pares · recorrer-diccionarios · crees que for k in d entrega la pareja de llave y valor, cuando entrega solo la llave
mc: conteo-sin-llave · recorrer-diccionarios · sumas 1 a una llave que todavía no existe, cuando primero hay que crearla y eso da KeyError
mc: conteo-reinicia · recorrer-diccionarios · asignas 1 a la llave en cada aparición, así que el conteo nunca pasa de 1
mc: mayor-devuelve-conteo · recorrer-diccionarios · devuelves el conteo mayor, cuando se pide la llave que lo tiene
mc: dict-ordenado-por-llave · recorrer-diccionarios · crees que el diccionario se recorre ordenado por llave, cuando se recorre en el orden en que se agregaron
mc: llaves-invertidas · estructuras-compuestas · inviertes el orden de las llaves y pides primero el dato y después el registro
mc: lista-con-llave · estructuras-compuestas · usas una llave para indexar la lista, cuando primero va la posición del diccionario
mc: for-externo-internos · estructuras-compuestas · crees que recorrer el diccionario externo entrega los diccionarios internos, cuando entrega sus llaves
mc: numero-como-texto · estructuras-compuestas · comparas o sumas como números valores que están guardados como texto
mc: interno-es-copia · estructuras-compuestas · crees que el diccionario interno guardado en otra variable es una copia, cuando cambiarlo cambia la estructura

## Preguntas

### P48 · dificultad 1 · kc: recorrer-diccionarios · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
precios = {"te": 3, "cafe": 5, "jugo": 4}
vistos = []
for p in precios:
    vistos.append(p)
print(vistos)
```

- A) [3, 5, 4] · [for-dict-valores]
- B) [('te', 3), ('cafe', 5), ('jugo', 4)] · [for-dict-pares]
- C) ['te', 'cafe', 'jugo'] · CORRECTA
- D) ['cafe', 'jugo', 'te'] · [dict-ordenado-por-llave]

solución: for p in precios recorre las llaves, en el orden en que se agregaron al diccionario.
Se agregan 'te', 'cafe' y 'jugo', en ese orden, y la lista queda ['te', 'cafe', 'jugo'].

### P49 · dificultad 2 · kc: recorrer-diccionarios · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
votos = {"sol": 30, "mar": 21, "luna": 30}
mejor = ""
maximo = 0
for k in votos:
    if votos[k] >= maximo:
        maximo = votos[k]
        mejor = k
print(mejor)
```

- A) luna · CORRECTA
- B) sol · [dict-ordenado-por-llave] recorres las llaves en orden alfabético, así que la última que empata en 30 es sol
- C) 30 · [mayor-devuelve-conteo]
- D) Da KeyError · [for-dict-pares] crees que k es la pareja de llave y valor, y buscas esa pareja como si fuera una llave

solución: el recorrido sigue el orden de inserción: sol, mar, luna.
sol: 30 >= 0, entonces maximo = 30 y mejor = "sol".
mar: 21 >= 30 es falso, no cambia nada.
luna: 30 >= 30 es verdadero (el >= acepta el empate), entonces mejor = "luna".
Se imprime la llave, luna, y no el conteo 30.

### P50 · dificultad 2 · kc: recorrer-diccionarios · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
inventario = {"tuerca": 5}
for pieza in ["tuerca", "perno", "tuerca"]:
    inventario[pieza] += 1
print(inventario)
```

- A) {'tuerca': 7, 'perno': 1} · [conteo-sin-llave] crees que += crea la llave que no existe y sigue contando desde 0
- B) {'perno': 1, 'tuerca': 7} · [dict-ordenado-por-llave] crees que += crea la llave que no existe y que el diccionario queda ordenado por llave
- C) {'tuerca': 1, 'perno': 1} · [conteo-reinicia] crees que cada aparición deja la cuenta de la llave en 1
- D) Da KeyError · CORRECTA

solución: "tuerca" ya existe: 5 + 1 = 6.
"perno" no existe todavía: inventario["perno"] += 1 primero lee inventario["perno"], y esa lectura da KeyError.
El programa se detiene ahí y no llega al print. Para contar bien, primero hay que crear la llave (if pieza in inventario: ... else: inventario[pieza] = 1).

### P51 · dificultad 3 · kc: recorrer-diccionarios · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
sala = {"p1": "verde", "p2": "rojo", "p3": "verde"}
conteo = {}
for puesto in sala:
    color = sala[puesto]
    conteo[color] += 1
print(conteo)
```

- A) {'rojo': 1, 'verde': 2} · [dict-ordenado-por-llave] crees que += crea la llave que no existe y que el diccionario queda ordenado por llave
- B) Da KeyError · CORRECTA
- C) {'verde': 2, 'rojo': 1} · [conteo-sin-llave] crees que += crea la llave que no existe y sigue contando desde 0
- D) {'verde': 1, 'rojo': 1} · [conteo-reinicia] crees que cada aparición deja la cuenta del color en 1

solución: for puesto in sala recorre las llaves "p1", "p2", "p3". Con cada una, color = sala[puesto] toma el valor: "verde", "rojo", "verde".
En la primera vuelta conteo está vacío y conteo["verde"] += 1 lee una llave que no existe: KeyError.
El programa se detiene ahí. Faltaba el if color in conteo: ... else: conteo[color] = 1.

### P52 · dificultad 3 · kc: recorrer-diccionarios · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
conteo = {}
for c in "banana":
    if c in conteo:
        conteo[c] += 1
    else:
        conteo[c] = 1
mejor = ""
maximo = 0
for k in conteo:
    if conteo[k] > maximo:
        maximo = conteo[k]
        mejor = k
print(mejor)
```

- A) 3 · [mayor-devuelve-conteo]
- B) b · [conteo-reinicia] crees que el conteo nunca pasa de 1, así que gana la primera llave
- C) a · CORRECTA
- D) Da KeyError · [for-dict-valores] crees que k es el valor del conteo y lo buscas como si fuera una llave

solución: primer ciclo, letra por letra: b -> {'b': 1}; a -> {'b': 1, 'a': 1}; n -> {'b': 1, 'a': 1, 'n': 1}; a -> a pasa a 2; n -> n pasa a 2; a -> a pasa a 3.
Queda conteo = {'b': 1, 'a': 3, 'n': 2}.
Segundo ciclo (k son las llaves): b tiene 1 > 0, mejor = "b"; a tiene 3 > 1, mejor = "a"; n tiene 2 > 3 es falso.
Se imprime la llave con el mayor conteo, a, y no el conteo 3.

### P53 · dificultad 1 · kc: estructuras-compuestas · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
cajas = {"c1": {"kg": "90"}, "c2": {"kg": "100"}}
total = ""
for c in cajas:
    total += cajas[c]["kg"]
print(total)
```

- A) 190 · [numero-como-texto]
- B) 90100 · CORRECTA
- C) Da TypeError · [for-externo-internos] crees que c es el diccionario interno y lo usas como llave de cajas
- D) Da KeyError · [llaves-invertidas]

solución: for c in cajas recorre las llaves externas "c1" y "c2"; cajas[c] es el diccionario interno y ["kg"] da su dato.
Los pesos están guardados como texto: "90" y "100". Con + se concatenan: "" + "90" = "90" y luego "90" + "100" = "90100".

### P54 · dificultad 2 · kc: estructuras-compuestas · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
tienda = {"t1": {"stock": 5}, "t2": {"stock": 9}}
t = tienda["t2"]
t["stock"] = 4
total = 0
for k in tienda:
    total += tienda[k]["stock"]
print(total)
```

- A) 9 · CORRECTA
- B) 14 · [interno-es-copia]
- C) Da KeyError · [llaves-invertidas]
- D) Da TypeError · [for-externo-internos] crees que k es el diccionario interno y lo usas como llave de tienda

solución: t = tienda["t2"] no copia el diccionario: t y tienda["t2"] son el mismo objeto.
t["stock"] = 4 cambia también tienda["t2"]["stock"], que pasa de 9 a 4.
El ciclo suma tienda["t1"]["stock"] + tienda["t2"]["stock"] = 5 + 4 = 9.

### P55 · dificultad 2 · kc: estructuras-compuestas · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
equipos = [{"nombre": "Rayos", "pts": "7"}, {"nombre": "Lobos", "pts": "10"}]
e = equipos[0]
e["pts"] = "9"
print(equipos[0]["pts"] + equipos[1]["pts"])
```

- A) 19 · [numero-como-texto]
- B) 710 · [interno-es-copia]
- C) Da TypeError · [lista-con-llave] primero pides la llave "pts" a la lista, cuando primero va la posición
- D) 910 · CORRECTA

solución: e = equipos[0] es el mismo diccionario que está en la lista, no una copia.
e["pts"] = "9" cambia equipos[0]["pts"] de "7" a "9".
Los puntos son texto: "9" + "10" se concatena y da "910" (no 19).

### P56 · dificultad 3 · kc: estructuras-compuestas · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
cajas = {"c1": {"kg": "90"}, "c2": {"kg": "100"}, "c3": {"kg": "25"}}
mayor = "c1"
for c in cajas:
    if cajas[c]["kg"] > cajas[mayor]["kg"]:
        mayor = c
print(mayor)
```

- A) c2 · [numero-como-texto]
- B) Da KeyError · [llaves-invertidas]
- C) c1 · CORRECTA
- D) Da TypeError · [for-externo-internos] crees que c es el diccionario interno y lo usas como llave de cajas

solución: los pesos son texto y las cadenas se comparan carácter por carácter.
"90" > "90" es falso. "100" > "90" es falso, porque "1" va antes que "9". "25" > "90" es falso, porque "2" va antes que "9".
mayor nunca cambia y se imprime c1 (como números, el mayor sería c2).

### P57 · dificultad 3 · kc: estructuras-compuestas · borrador · origen: ia (sonnet-5.5)
¿Qué imprime este programa?
```
paquetes = [{"id": "p1", "peso": "90"}, {"id": "p2", "peso": "100"}, {"id": "p3", "peso": "25"}]
mayor = paquetes[0]
for p in paquetes:
    if p["peso"] > mayor["peso"]:
        mayor = p
mayor["peso"] = "0"
print(paquetes[0]["peso"] + paquetes[1]["peso"])
```

- A) 0100 · CORRECTA
- B) 900 · [numero-como-texto]
- C) 90100 · [interno-es-copia]
- D) Da TypeError · [lista-con-llave] primero pides la llave "peso" a la lista, cuando primero va la posición

solución: los pesos son texto, así que se comparan como cadenas: "100" > "90" es falso ("1" va antes que "9") y "25" > "90" es falso.
mayor sigue siendo el primer diccionario, paquetes[0], y no es una copia: mayor["peso"] = "0" cambia paquetes[0]["peso"] a "0".
Se imprime "0" + "100" = 0100.
