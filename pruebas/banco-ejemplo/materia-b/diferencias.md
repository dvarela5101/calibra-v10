# Diferencias finitas

## Habilidades
kc: diferencia-adelante · Aproximar la derivada con la diferencia hacia adelante · prerrequisitos: materia-a/potencia

## Errores
mc: divide-mal · diferencia-adelante · divides entre 2h en la diferencia hacia adelante
mc: resta-al-reves · diferencia-adelante · restas f(x) − f(x + h), en el orden equivocado
mc: olvida-h · diferencia-adelante · no divides entre h

## Preguntas

### P1 · dificultad 2 · kc: diferencia-adelante · revisada · origen: humano · revisó: Carla
¿Qué imprime este programa?
```
def f(x):
    return x ** 2

h = 0.25
print((f(1 + h) - f(1)) / h)
```
Es la diferencia hacia adelante de f en 1.

- A) 2.25 · CORRECTA
- B) 1.125 · [divide-mal]
- C) -2.25 · [resta-al-reves]
- D) 0.5625 · [olvida-h]
