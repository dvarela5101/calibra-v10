# Cadenas y listas como secuencias

Lo nuevo del nivel 3 sobre cadenas (índices, cortes con paso, find, inmutabilidad) y las listas: crearlas, modificarlas con sus métodos, pasar de cadena a lista y de vuelta, y el comportamiento de las referencias.

## Habilidades
kc: strings-indices · Indexar cadenas, también con índices negativos, extraer cortes con y sin paso, usar find, count y replace, y saber que las cadenas son inmutables · prerrequisitos: cadenas-diccionarios
kc: listas-operaciones · Crear y modificar listas: asignar por índice, cortes, append, insert, extend, pop, remove, sort y reverse, split y join, list(range(...)) y [0] * n · prerrequisitos: strings-indices
kc: listas-referencias · Distinguir alias de copia: asignar una lista no la copia, is frente a ==, una lista pasada a una función se modifica afuera, y clonar con [:] o copy() · prerrequisitos: listas-operaciones, funciones

## Errores
mc: idx-desde-uno · strings-indices · cuentas las posiciones desde 1, cuando el primer carácter tiene índice 0
mc: idx-len-es-ultimo · strings-indices · crees que s[len(s)] es el último carácter, cuando el último es s[len(s) - 1] y s[len(s)] da IndexError
mc: negativo-desde-izquierda · strings-indices · cuentas los índices negativos desde la izquierda o crees que -1 es el primero, cuando -1 es el último
mc: corte-incluye-fin · strings-indices · incluyes el índice final del corte, cuando el corte se detiene antes de él
mc: paso-toma-seguidos · strings-indices · con un paso en el corte tomas varios caracteres seguidos, cuando el paso salta de tantos en tantos
mc: str-mutable · strings-indices · crees que s[i] = "x" cambia un carácter de la cadena, cuando las cadenas no se pueden modificar y eso da TypeError
mc: find-sin-menos-uno · strings-indices · crees que find devuelve False, 0 o un error cuando no encuentra el texto, cuando devuelve -1
mc: replace-modifica · strings-indices · crees que replace cambia la cadena original, cuando devuelve una nueva
mc: metodo-devuelve-lista · listas-operaciones · crees que append, sort o reverse devuelven la lista, cuando la modifican y devuelven None
mc: append-como-extend · listas-operaciones · crees que append de una lista agrega sus elementos uno por uno, cuando la agrega entera como un solo elemento
mc: pop-por-valor · listas-operaciones · confundes pop(i), que quita por posición y devuelve el elemento, con remove(x), que quita por valor
mc: insert-reemplaza · listas-operaciones · crees que insert reemplaza el elemento de esa posición, cuando lo corre a la derecha
mc: asignar-fuera-de-rango · listas-operaciones · crees que asignar en lista[len(lista)] agrega al final, cuando da IndexError
mc: join-mal-separador · listas-operaciones · crees que join también pone el separador al principio o al final, cuando solo lo pone entre elementos
mc: split-devuelve-str · listas-operaciones · crees que split devuelve una cadena o que conserva el separador, cuando devuelve una lista sin él
mc: sort-sin-mayusculas · listas-operaciones · crees que sort ordena sin distinguir mayúsculas, cuando las mayúsculas van antes que todas las minúsculas
mc: asignar-copia · listas-referencias · crees que b = a hace una copia de la lista, cuando las dos variables apuntan a la misma
mc: is-mismo-contenido · listas-referencias · crees que is da True cuando dos listas tienen el mismo contenido, cuando solo lo da si son la misma lista
mc: igual-misma-lista · listas-referencias · crees que == solo da True si las dos variables son la misma lista, cuando compara el contenido
mc: parametro-copia-lista · listas-referencias · crees que la función trabaja sobre una copia de la lista, cuando recibe la misma lista y la modifica
mc: corte-es-alias · listas-referencias · crees que b = a[:] sigue apuntando a la misma lista, cuando crea una copia
mc: reasignar-parametro · listas-referencias · crees que asignar una lista nueva al parámetro cambia la lista de afuera, cuando solo cambia a qué apunta el parámetro

## Preguntas

### P23 · dificultad 1 · kc: strings-indices · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
placa = "KXR905"
print(placa[-1], placa[1])
```

- A) 5 X · CORRECTA
- B) K X · [negativo-desde-izquierda]
- C) 5 K · [idx-desde-uno]
- D) K K · [idx-desde-uno] cuentas desde 1 y tomas el -1 como el primer carácter

solución: placa[-1] es el último carácter, 5. placa[1] es el segundo, X, porque el primero tiene índice 0. Imprime 5 X.

### P24 · dificultad 2 · kc: strings-indices · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
serie = "ZXQ-4821"
print(serie[-4:], serie[:4])
```

- A) -4821 ZXQ- · [negativo-desde-izquierda]
- B) 4821 ZXQ- · CORRECTA
- C) 4821 ZXQ-4 · [corte-incluye-fin]
- D) -4821 ZXQ-4 · [negativo-desde-izquierda] cuentas el -4 desde la izquierda y además incluyes el índice final

solución: serie[-4:] toma desde el cuarto carácter contando desde el final: 4821. serie[:4] toma los índices 0 a 3 y se detiene antes del 4: ZXQ-. Imprime 4821 ZXQ-.

### P25 · dificultad 2 · kc: strings-indices · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
cod = "A1B2C3D4E5"
print(cod[1:7:2])
```

- A) 123 · CORRECTA
- B) 1B2C3D · [paso-toma-seguidos]
- C) 1234 · [corte-incluye-fin]
- D) ABC · [idx-desde-uno]

solución: El corte empieza en el índice 1 y se detiene antes del 7, saltando de 2 en 2: índices 1, 3 y 5, que son 1, 2 y 3. Imprime 123.

### P26 · dificultad 3 · kc: strings-indices · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
nombre = "informe_final_v2"
i = nombre.find("final")
j = nombre.find("v3")
print(i, j, nombre[j])
```

- A) 8 0 i · [find-sin-menos-uno]
- B) 8 -1 2 · CORRECTA
- C) 9 -1 2 · [idx-desde-uno]
- D) 8 False i · [find-sin-menos-uno]

solución: find("final") da 8, el índice donde empieza. "v3" no está, así que find da -1. nombre[-1] es el último carácter, 2. Imprime 8 -1 2.

### P27 · dificultad 3 · kc: strings-indices · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
ruta = "datos/2026/enero"
nueva = ruta.replace("2026", "2027")
print(ruta.count("/"), nueva[-5:], ruta[6:10])
```

- A) 2 enero 2026/ · [corte-incluye-fin]
- B) 2 enero /202 · [idx-desde-uno]
- C) 2 enero 2027 · [replace-modifica] crees que replace cambió ruta, cuando devolvió una cadena nueva que quedó en nueva
- D) 2 enero 2026 · CORRECTA

solución: ruta.count("/") da 2. replace devuelve una cadena nueva (nueva) y ruta no cambia. nueva[-5:] es enero. ruta[6:10] toma los índices 6 a 9 de la original: 2026. Imprime 2 enero 2026.

### P28 · dificultad 1 · kc: listas-operaciones · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
notas = [3, 5, 4]
notas.insert(1, 9)
print(notas.append(2), notas)
```

- A) [3, 9, 5, 4, 2] [3, 9, 5, 4, 2] · [metodo-devuelve-lista]
- B) None [3, 9, 4, 2] · [insert-reemplaza]
- C) None [3, 9, 5, 4, 2] · CORRECTA
- D) [3, 9, 4, 2] [3, 9, 4, 2] · [insert-reemplaza] crees que insert reemplaza el 5 y que append devuelve la lista

solución: insert(1, 9) mete el 9 en la posición 1 y corre el 5 y el 4 a la derecha: [3, 9, 5, 4]. append(2) agrega al final y devuelve None. Los argumentos se evalúan en orden, así que print recibe None y la lista ya con el 2. Imprime None [3, 9, 5, 4, 2].

### P29 · dificultad 2 · kc: listas-operaciones · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
a = [1, 2]
b = [7, 8]
r = a.append(b)
a.extend([9])
print(r, a, len(a))
```

- A) [1, 2, [7, 8], 9] [1, 2, [7, 8], 9] 4 · [metodo-devuelve-lista]
- B) None [1, 2, [7, 8], 9] 4 · CORRECTA
- C) None [1, 2, 7, 8, 9] 5 · [append-como-extend]
- D) [1, 2, 7, 8, 9] [1, 2, 7, 8, 9] 5 · [append-como-extend] crees que append agrega los elementos uno por uno y que devuelve la lista

solución: a.append(b) agrega b entera como un solo elemento y devuelve None, así que r es None. Después extend([9]) agrega el 9. La lista queda [1, 2, [7, 8], 9], con 4 elementos. Imprime None [1, 2, [7, 8], 9] 4.

### P30 · dificultad 2 · kc: listas-operaciones · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
letras = ["b", "C", "a", "D"]
orden = letras.sort()
print(orden, letras)
```

- A) None ['a', 'b', 'C', 'D'] · [sort-sin-mayusculas]
- B) ['C', 'D', 'a', 'b'] ['C', 'D', 'a', 'b'] · [metodo-devuelve-lista]
- C) ['a', 'b', 'C', 'D'] ['a', 'b', 'C', 'D'] · [sort-sin-mayusculas] crees que sort ignora las mayúsculas y que devuelve la lista
- D) None ['C', 'D', 'a', 'b'] · CORRECTA

solución: sort ordena la lista en su lugar y devuelve None, así que orden es None. Las mayúsculas van antes que las minúsculas: ['C', 'D', 'a', 'b']. Imprime None ['C', 'D', 'a', 'b'].

### P31 · dificultad 3 · kc: listas-operaciones · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
fila = [10, 20, 30, 40, 20]
x = fila.pop(2)
y = fila.remove(20)
print(x, y, fila)
```

- A) 30 [10, 40, 20] [10, 40, 20] · [metodo-devuelve-lista]
- B) Da ValueError · [pop-por-valor] crees que pop(2) quita el valor 2 y como no está da error
- C) 30 None [10, 40, 20] · CORRECTA
- D) Da IndexError · [pop-por-valor] crees que remove(20) quita la posición 20

solución: pop(2) quita la posición 2 y devuelve 30: queda [10, 20, 40, 20]. remove(20) quita el primer 20 que encuentra y devuelve None: queda [10, 40, 20]. Imprime 30 None [10, 40, 20].

### P32 · dificultad 3 · kc: listas-operaciones · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
texto = "uno,dos,tres"
partes = texto.split(",")
partes.reverse()
print("-".join(partes), len(partes))
```

- A) Da AttributeError · [split-devuelve-str] crees que split devuelve una cadena, y las cadenas no tienen reverse
- B) tres-dos,-uno, 3 · [split-devuelve-str] crees que split conserva la coma en cada pedazo
- C) tres-dos-uno- 3 · [join-mal-separador]
- D) tres-dos-uno 3 · CORRECTA

solución: split(",") da ['uno', 'dos', 'tres'] sin las comas. reverse la invierte en su lugar. join pone el guion solo entre elementos: tres-dos-uno. La lista tiene 3 elementos. Imprime tres-dos-uno 3.

### P33 · dificultad 1 · kc: listas-referencias · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
pedido = [8, 3]
respaldo = [8, 3]
vista = pedido
print(pedido is respaldo, pedido == respaldo, vista is pedido)
```

- A) True True True · [is-mismo-contenido]
- B) False False True · [igual-misma-lista]
- C) False True True · CORRECTA
- D) False True False · [asignar-copia]

solución: pedido y respaldo son dos listas distintas con el mismo contenido: pedido is respaldo da False y pedido == respaldo da True. vista = pedido no copia, así que vista is pedido da True. Imprime False True True.

### P34 · dificultad 2 · kc: listas-referencias · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
a = [1, 2, 3]
b = a
c = a[:]
print(a is b, a is c, a == c)
```

- A) True False True · CORRECTA
- B) False False True · [asignar-copia]
- C) True True True · [corte-es-alias]
- D) True False False · [igual-misma-lista]

solución: b = a hace que b sea la misma lista que a: a is b da True. c = a[:] es una copia: a is c da False, pero tiene el mismo contenido y a == c da True. Imprime True False True.

### P35 · dificultad 2 · kc: listas-referencias · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
def agregar(v):
    v.append(0)

a = [1]
b = a
agregar(b)
print(a, b, a is b)
```

- A) [1] [1] True · [parametro-copia-lista]
- B) [1] [1, 0] False · [asignar-copia]
- C) [1] [1] False · [parametro-copia-lista] crees que b = a copia la lista y que la función trabaja sobre otra copia
- D) [1, 0] [1, 0] True · CORRECTA

solución: b = a no copia: a y b son la misma lista. agregar recibe esa misma lista y le agrega el 0, y el cambio se ve afuera en a y en b. a is b da True. Imprime [1, 0] [1, 0] True.

### P36 · dificultad 3 · kc: listas-referencias · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
def f(v):
    v.append(1)
    v = [0, 0]

b = [4, 5]
a = b
f(a)
print(a, b)
```

- A) [0, 0] [4, 5, 1] · [reasignar-parametro]
- B) [4, 5, 1] [4, 5, 1] · CORRECTA
- C) [4, 5] [4, 5] · [parametro-copia-lista]
- D) [4, 5, 1] [4, 5] · [asignar-copia]

solución: a = b hace que a y b sean la misma lista. f recibe esa lista y v.append(1) la modifica, así que se ve en a y en b: [4, 5, 1]. Después v = [0, 0] solo hace que v apunte a otra lista; ni a ni b cambian. Imprime [4, 5, 1] [4, 5, 1].

### P37 · dificultad 3 · kc: listas-referencias · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
orig = [1, 2, 3]
c = orig[:]
alias = orig
c.append(4)
alias[0] = 9
print(orig, c, orig is alias)
```

- A) [9, 2, 3, 4] [9, 2, 3, 4] True · [corte-es-alias]
- B) [1, 2, 3] [1, 2, 3, 4] False · [asignar-copia]
- C) [9, 2, 3] [1, 2, 3, 4] True · CORRECTA
- D) [1, 2, 3, 4] [1, 2, 3, 4] False · [asignar-copia] crees que alias = orig copia la lista y que orig[:] sigue siendo la misma

solución: c = orig[:] es una copia: el append la deja en [1, 2, 3, 4] y no toca a orig. alias = orig es la misma lista, así que alias[0] = 9 también cambia orig: [9, 2, 3]. orig is alias da True. Imprime [9, 2, 3] [1, 2, 3, 4] True.

### P64 · dificultad 2 · kc: strings-indices · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
dia = "lunes7"
dia[len(dia)] = "8"
print(dia)
```

- A) Da IndexError · [str-mutable] crees que las cadenas se pueden modificar y que el único problema es el índice fuera de rango
- B) lunes8 · [idx-len-es-ultimo] crees que dia[len(dia)] es el último carácter y que la asignación lo cambia
- C) lunes78 · [str-mutable] crees que asignar un carácter en la posición len(dia) agrega el 8 al final de la cadena
- D) Da TypeError · CORRECTA

solución: Las cadenas no se pueden modificar: dia[...] = "8" da TypeError sin importar el índice, aunque len(dia) tampoco sea un índice válido. El programa no llega al print. Da TypeError.

### P65 · dificultad 3 · kc: strings-indices · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
palabra = "sol"
palabra[0] = palabra[len(palabra)]
print(palabra)
```

- A) Da TypeError · [idx-len-es-ultimo] crees que palabra[len(palabra)] es el último carácter, y solo ves el error de asignar en una cadena
- B) lol · [str-mutable] crees que palabra[len(palabra)] es el último carácter y que se puede cambiar el primero asignándolo
- C) Da IndexError · CORRECTA
- D) sol · [replace-modifica] crees que la asignación produce una cadena nueva que no guardas, como replace, y palabra queda igual

solución: Python evalúa primero el lado derecho: palabra[len(palabra)] es palabra[3], que no existe en una cadena de 3 caracteres, y da IndexError antes de intentar asignar. Si el índice fuera válido, la asignación daría TypeError porque las cadenas no se pueden modificar. Da IndexError.

### P66 · dificultad 2 · kc: listas-operaciones · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué imprime este programa?
```
cola = ["a", "b", "c"]
cola.insert(1, "x")
cola[len(cola)] = "d"
print("-".join(cola))
```

- A) a-x-b-c-d- · [join-mal-separador] crees que join también pone el separador al final y que asignar en cola[len(cola)] agrega al final
- B) a-x-c-d · [insert-reemplaza] crees que insert reemplaza la b y que asignar en cola[len(cola)] agrega al final
- C) Da IndexError · CORRECTA
- D) a-x-b-c-d · [asignar-fuera-de-rango]

solución: insert(1, "x") deja la lista en ['a', 'x', 'b', 'c'], con 4 elementos. cola[len(cola)] es cola[4], un índice que no existe: asignar por índice no agrega, da IndexError. Para agregar al final se usa append. Da IndexError.
