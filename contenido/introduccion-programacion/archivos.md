# Manejo de archivos

Abrir, leer o escribir y cerrar un archivo de texto, leer línea por línea hasta el final y convertir cada línea de un CSV en una lista y luego en un diccionario. Como el examen es en papel, el contenido del archivo va en el enunciado.

## Habilidades
kc: archivos · Leer y escribir archivos de texto: modos r, w y a, readline hasta la cadena vacía, el salto de línea final, close, y convertir cada línea CSV en lista y luego en diccionario con los tipos correctos · prerrequisitos: while-ciclo, listas-operaciones

## Errores
mc: readline-sin-salto · archivos · crees que readline devuelve la línea sin el salto de línea, cuando lo conserva al final
mc: fin-es-none · archivos · crees que al llegar al final readline devuelve None o da error, cuando devuelve la cadena vacía
mc: w-agrega · archivos · crees que abrir en modo w agrega al final, cuando borra el contenido anterior
mc: split-respeta-comillas · archivos · crees que split(",") respeta las comas que están dentro de un campo entre comillas
mc: bool-de-texto · archivos · crees que bool("False") da False, cuando cualquier cadena no vacía da True
mc: encabezado-como-dato · archivos · olvidas que la primera línea es el encabezado y la cuentas como un dato
mc: write-agrega-salto · archivos · crees que write agrega el salto de línea por su cuenta

## Preguntas

### P58 · dificultad 1 · kc: archivos · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El archivo lecturas.txt contiene dos líneas, "ab" y "cd", cada una terminada con su salto de línea:
```
ab
cd
```
¿Qué imprime este programa?
```
f = open("lecturas.txt", "r")
a = f.readline()
f.readline()
c = f.readline()
f.close()
print(len(a), repr(c))
```

- A) 2 '' · [readline-sin-salto]
- B) 3 None · [fin-es-none]
- C) 3 '' · CORRECTA
- D) 2 None · [fin-es-none] crees que al final readline devuelve None y que la línea viene sin el salto de línea

solución: la primera readline devuelve ab con su salto de línea: 3 caracteres, porque conserva el salto. La segunda lee cd y no se guarda. La tercera ya está en el final del archivo y devuelve la cadena vacía "", no None; repr la muestra como ''. Imprime 3 ''.

### P59 · dificultad 2 · kc: archivos · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El archivo prestamos.txt contiene, antes de correr el programa, las líneas "A1" y "B2" (cada una con su salto de línea):
```
A1
B2
```
¿Qué imprime este programa?
```
f = open("prestamos.txt", "w")
f.write("C3")
f.write("D4\n")
f.close()
f = open("prestamos.txt", "r")
linea = f.readline()
f.close()
print(linea.strip(), len(linea))
```

- A) C3 3 · [write-agrega-salto]
- B) C3D4 5 · CORRECTA
- C) A1 3 · [w-agrega]
- D) C3D4 4 · [readline-sin-salto]

solución: el modo "w" borra A1 y B2 al abrir. write no agrega saltos, así que el archivo queda con una sola línea: C3D4 seguido del salto de línea que trae el segundo write. readline la devuelve completa, con el salto al final, así que linea tiene 5 caracteres; strip() quita el salto solo para imprimir. Imprime C3D4 5.

### P60 · dificultad 2 · kc: archivos · revisada · origen: ia (sonnet-5.5) · ⚠ revisar · revisó: dvarela5101
El archivo catalogo.csv contiene un encabezado y un producto cuyo nombre lleva una coma entre comillas; cada una de las dos líneas termina con su salto de línea:
```
producto,precio
"Tornillo, M4",150
```
¿Qué imprime este programa?
```
f = open("catalogo.csv", "r")
f.readline()
linea = f.readline()
f.close()
campos = linea.split(",")
print(len(campos), len(campos[-1]))
```

- A) 2 4 · [split-respeta-comillas]
- B) 3 3 · [readline-sin-salto]
- C) 2 3 · [split-respeta-comillas] crees que split respeta las comas entre comillas y que la línea no trae salto de línea
- D) 3 4 · CORRECTA

solución: linea es la segunda línea completa, con su salto de línea al final. split(",") corta en cada coma, también en la que está dentro de las comillas, así que quedan 3 campos: "Tornillo, M4" partido en dos y el precio. El último campo es 150 más el salto de línea: 4 caracteres. Imprime 3 4.

### P61 · dificultad 2 · kc: archivos · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El archivo equipos.txt contiene:
```
equipo,activo
A,True
B,False
C,False
```
¿Qué imprime este programa?
```
f = open("equipos.txt", "r")
encabezado = f.readline()
linea = f.readline()
n = 0
while linea != "":
    campos = linea.replace("\n", "").split(",")
    if bool(campos[1]):
        n = n + 1
    linea = f.readline()
f.close()
print(n)
```

- A) 1 · [bool-de-texto]
- B) 2 · [bool-de-texto] crees que bool de un texto depende de lo que dice y además cuentas el encabezado como un dato
- C) 4 · [encabezado-como-dato]
- D) 3 · CORRECTA

solución: el encabezado se lee antes del ciclo y no se cuenta. Las tres líneas de datos dan los campos "True", "False" y "False". bool aplicado a un texto no vacío siempre da True, sin importar lo que diga, así que las tres suman. Imprime 3.

### P62 · dificultad 3 · kc: archivos · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El archivo estaciones.csv contiene un encabezado y dos registros, el primero con una coma dentro de comillas:
```
estacion,alerta
"Norte, A",True
Sur,False
```
¿Qué imprime este programa?
```
f = open("estaciones.csv", "r")
encabezado = f.readline()
linea = f.readline()
total = 0
while linea != "":
    campos = linea.replace("\n", "").split(",")
    total = total + len(campos)
    linea = f.readline()
f.close()
print(total, repr(linea))
```

- A) 5 None · [fin-es-none]
- B) 7 '' · [encabezado-como-dato]
- C) 4 '' · [split-respeta-comillas]
- D) 5 '' · CORRECTA

solución: el encabezado se lee antes del ciclo y no suma. Primer registro: split(",") también corta la coma entre comillas y da 3 campos. Segundo registro: 2 campos. Total 5. Al salir del ciclo linea vale la cadena vacía, que es lo que devuelve readline al final del archivo, no None. Imprime 5 ''.

### P63 · dificultad 3 · kc: archivos · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El archivo registro.txt contiene, antes de correr el programa, estas tres líneas (cada una con su salto de línea):
```
dia,visitas
lunes,10
martes,12
```
¿Qué imprime este programa?
```
f = open("registro.txt", "w")
f.write("dia,visitas\n")
f.write("jueves,7")
f.write("viernes,9")
f.write("sabado,4\n")
f.close()
f = open("registro.txt", "r")
f.readline()
n = 0
linea = f.readline()
while linea != "":
    n = n + 1
    linea = f.readline()
f.close()
print(n)
```

- A) 3 · [write-agrega-salto]
- B) 1 · CORRECTA
- C) 4 · [w-agrega]
- D) 2 · [encabezado-como-dato]

solución: el modo "w" borra las tres líneas originales. El archivo queda con el encabezado dia,visitas en su propia línea y una sola línea más, jueves,7viernes,9sabado,4, porque solo el último write lleva salto. La primera readline consume el encabezado y el ciclo cuenta 1 línea de datos. Imprime 1.
