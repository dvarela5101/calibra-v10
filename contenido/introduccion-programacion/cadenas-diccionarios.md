# Cadenas y diccionarios

Errores que vale la pena cazar: contar los índices desde 1, incluir el índice final en un corte, creer que un método de str modifica el texto original, y creer que una función recibe una copia del diccionario.

## Habilidades
kc: cadenas-diccionarios · Cadenas y diccionarios

## Errores
mc: cadenas-diccionarios-e1 · cadenas-diccionarios · cuentas las posiciones desde 1 en vez de desde 0
mc: cadenas-diccionarios-e2 · cadenas-diccionarios · incluyes el índice final del corte, cuando el corte se detiene antes de él
mc: cadenas-diccionarios-e3 · cadenas-diccionarios · cuentas desde 1 y además incluyes el índice final
mc: cadenas-diccionarios-e4 · cadenas-diccionarios · crees que upper() cambia el string original, cuando devuelve uno nuevo que aquí nadie guarda
mc: cadenas-diccionarios-e5 · cadenas-diccionarios · confundes upper() con capitalize(), que solo pone en mayúscula la primera letra
mc: cadenas-diccionarios-e6 · cadenas-diccionarios · crees que upper() deja la variable vacía después de usarla
mc: cadenas-diccionarios-e7 · cadenas-diccionarios · crees que la función trabaja sobre una copia del diccionario, cuando recibe el mismo diccionario y lo modifica
mc: cadenas-diccionarios-e8 · cadenas-diccionarios · confundes el valor de la llave con lo que devuelve vender(), que no tiene return
mc: cadenas-diccionarios-e9 · cadenas-diccionarios · confundes el valor de una llave con el diccionario completo

## Preguntas

### P10 · dificultad 2 · kc: cadenas-diccionarios · revisada · origen: humano · revisó: prototipo
¿Qué imprime este programa?
```
s = "Python"
print(s[1:4])
```

- A) yth · CORRECTA
- B) Pyt · [cadenas-diccionarios-e1]
- C) ytho · [cadenas-diccionarios-e2]
- D) Pyth · [cadenas-diccionarios-e3]

### P11 · dificultad 2 · kc: cadenas-diccionarios · revisada · origen: humano · revisó: prototipo
¿Qué imprime este programa?
```
s = "hola"
s.upper()
print(s)
```

- A) hola · CORRECTA
- B) HOLA · [cadenas-diccionarios-e4]
- C) Hola · [cadenas-diccionarios-e5]
- D) None · [cadenas-diccionarios-e6]

### P12 · dificultad 3 · kc: cadenas-diccionarios · revisada · origen: humano · revisó: prototipo
¿Qué imprime este programa?
```
sala = {"vendidas": 0}
def vender(d, n):
    d["vendidas"] += n
vender(sala, 5)
print(sala["vendidas"])
```

- A) 5 · CORRECTA
- B) 0 · [cadenas-diccionarios-e7]
- C) None · [cadenas-diccionarios-e8]
- D) {'vendidas': 5} · [cadenas-diccionarios-e9]
