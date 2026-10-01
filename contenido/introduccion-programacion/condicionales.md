# Booleanos y condicionales

Errores que vale la pena cazar: aplicar mal las leyes de De Morgan, creer que un if/elif ejecuta todas las ramas verdaderas, y escribir `color == "azul" or "verde"` creyendo que compara con los dos valores.

## Habilidades
kc: condicionales · Booleanos y condicionales

## Errores
mc: condicionales-e1 · condicionales · niegas cada parte pero dejas el and, cuando De Morgan lo cambia por or
mc: condicionales-e2 · condicionales · cambias el and por or pero te olvidas de negar cada parte
mc: condicionales-e3 · condicionales · aplicas el not solo al primer término
mc: condicionales-e4 · condicionales · crees que Python escoge la condición más específica, cuando ejecuta la primera que sea verdadera
mc: condicionales-e5 · condicionales · crees que un if/elif ejecuta todas las ramas cuya condición es verdadera
mc: condicionales-e6 · condicionales · crees que las condiciones de un if/elif tienen que ser excluyentes
mc: condicionales-e7 · condicionales · crees que or compara color con cada valor, cuando "verde" por sí solo ya cuenta como verdadero
mc: condicionales-e8 · condicionales · crees que no se puede poner un str suelto en una condición
mc: condicionales-e9 · condicionales · crees que si la primera comparación es falsa el if se salta también el else

## Preguntas

### P7 · dificultad 2 · kc: condicionales · revisada · origen: humano · revisó: prototipo
¿Cuál expresión es equivalente a not (a and b)?

- A) not a or not b · CORRECTA
- B) not a and not b · [condicionales-e1]
- C) a or b · [condicionales-e2]
- D) not a and b · [condicionales-e3]

### P8 · dificultad 2 · kc: condicionales · revisada · origen: humano · revisó: prototipo
¿Qué imprime este programa?
```
nota = 4.5
if nota >= 3:
    print("aprobó")
elif nota >= 4:
    print("excelente")
else:
    print("reprobó")
```

- A) aprobó · CORRECTA
- B) excelente · [condicionales-e4]
- C) aprobó y luego excelente · [condicionales-e5]
- D) Un error, porque dos condiciones son verdaderas a la vez · [condicionales-e6]

### P9 · dificultad 3 · kc: condicionales · revisada · origen: humano · revisó: prototipo
¿Qué imprime este programa?
```
color = "rojo"
if color == "azul" or "verde":
    print("frío")
else:
    print("cálido")
```

- A) frío · CORRECTA
- B) cálido · [condicionales-e7]
- C) Un error de sintaxis · [condicionales-e8]
- D) No imprime nada · [condicionales-e9]
