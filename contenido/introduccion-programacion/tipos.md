# Tipos, operadores y conversión

Errores que vale la pena cazar: confundir `//`, `/` y `%`, creer que un texto con dígitos se comporta como número, y olvidar que `input()` siempre devuelve un str.

## Habilidades
kc: tipos · Tipos, operadores y conversión

## Errores
mc: tipos-e1 · tipos · confundes % (el residuo) con // (el cociente de la división entera)
mc: tipos-e2 · tipos · confundes % con la división normal /
mc: tipos-e3 · tipos · crees que % calcula un porcentaje, el 17 % de 5
mc: tipos-e4 · tipos · tratas "3" como el número 3 aunque está entre comillas
mc: tipos-e5 · tipos · multiplicas "3" como número pero después concatenas el 4 como texto
mc: tipos-e6 · tipos · crees que un str no se puede multiplicar por un int, cuando eso lo repite
mc: tipos-e7 · tipos · olvidas que input() siempre devuelve un str, aunque el usuario escriba un número
mc: tipos-e8 · tipos · crees que Python convierte el 1 en texto por su cuenta para concatenar
mc: tipos-e9 · tipos · confundes el + con la coma de print, que separa valores con un espacio

## Preguntas

### P1 · dificultad 1 · kc: tipos · revisada · origen: humano · revisó: prototipo
¿Qué imprime este programa?
```
print(17 % 5)
```

- A) 2 · CORRECTA
- B) 3 · [tipos-e1]
- C) 3.4 · [tipos-e2]
- D) 0.85 · [tipos-e3]

### P2 · dificultad 2 · kc: tipos · revisada · origen: humano · revisó: prototipo
¿Qué imprime este programa?
```
x = "3"
y = 4
print(x * 2 + str(y))
```

- A) 334 · CORRECTA
- B) 10 · [tipos-e4]
- C) 64 · [tipos-e5]
- D) TypeError · [tipos-e6]

### P3 · dificultad 2 · kc: tipos · revisada · origen: humano · revisó: prototipo
El programa es:
```
n = input("Edad: ")
print(n + 1)
```
y el usuario escribe 20. ¿Qué pasa?

- A) Sale un TypeError, porque no se puede sumar un str con un int · CORRECTA
- B) Imprime 21 · [tipos-e7]
- C) Imprime 201 · [tipos-e8]
- D) Imprime 20 1 · [tipos-e9]
