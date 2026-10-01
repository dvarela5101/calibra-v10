# Funciones, return y variables locales

Errores que vale la pena cazar: confundir `print` con `return`, creer que asignar una variable dentro de una función cambia la de afuera, y emparejar argumentos por el nombre de la variable en vez de por la posición.

## Habilidades
kc: funciones · Funciones, return y variables locales

## Errores
mc: funciones-e1 · funciones · crees que print dentro de la función también devuelve el valor
mc: funciones-e2 · funciones · crees que la función no imprime nada cuando su resultado se guarda en una variable
mc: funciones-e3 · funciones · crees que una función sin return no se puede asignar a una variable
mc: funciones-e4 · funciones · crees que asignar x dentro de la función cambia la x de afuera, cuando crea una variable local
mc: funciones-e5 · funciones · confundes el valor de x con lo que devuelve cambiar(), que no tiene return
mc: funciones-e6 · funciones · crees que una función no puede crear una variable con el mismo nombre de una de afuera
mc: funciones-e7 · funciones · crees que x va con a y y va con b porque x se definió primero, cuando manda la posición en la llamada
mc: funciones-e8 · funciones · crees que // siempre devuelve un float
mc: funciones-e9 · funciones · divides x entre y y además usas la división normal

## Preguntas

### P4 · dificultad 2 · kc: funciones · revisada · origen: humano · revisó: prototipo
¿Qué imprime este programa?
```
def doble(x):
    print(x * 2)
r = doble(5)
print(r)
```

- A) 10 y luego None · CORRECTA
- B) 10 y luego 10 · [funciones-e1]
- C) Solo None · [funciones-e2]
- D) Un error, porque doble no tiene return · [funciones-e3]

### P5 · dificultad 2 · kc: funciones · revisada · origen: humano · revisó: prototipo
¿Qué imprime este programa?
```
x = 5
def cambiar():
    x = 10
cambiar()
print(x)
```

- A) 5 · CORRECTA
- B) 10 · [funciones-e4]
- C) None · [funciones-e5]
- D) Un error, porque x no está definida dentro de la función · [funciones-e6]

### P6 · dificultad 3 · kc: funciones · revisada · origen: humano · revisó: prototipo
¿Qué imprime este programa?
```
def dividir(a, b):
    return a // b
x = 3
y = 12
print(dividir(y, x))
```

- A) 4 · CORRECTA
- B) 0 · [funciones-e7]
- C) 4.0 · [funciones-e8]
- D) 0.25 · [funciones-e9]
